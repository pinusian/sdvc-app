import { describe, expect, it, vi, beforeEach } from "vitest";
import { applySubscriptionEvent } from "@/lib/billing/subscription";

/**
 * [P6-6] Stripe 사건 → 우리 등급/구독상태.
 * 결제하면 올라가고, 미납·해지면 내려간다. 이 값이 [P6-4] 차단 판정의 근거다.
 */

function fakeAdmin() {
  const updates: { table: string; values: Record<string, unknown>; where: unknown[] }[] = [];
  const client = {
    from(table: string) {
      return {
        // 조회는 이 테스트의 관심사가 아니므로 빈 결과를 준다
        // (기본 lifecycle 훅이 프로젝트 목록을 읽을 때 쓰인다)
        select() {
          const chain = {
            eq() {
              return chain;
            },
            async maybeSingle() {
              // 고객 id로 사용자를 찾는 조회 — 실제로는 프로필이 있다
              return { data: { id: "user-1" }, error: null };
            },
            then(resolve: (r: unknown) => unknown) {
              return resolve({ data: [], error: null });
            },
          };
          return chain;
        },
        update(values: Record<string, unknown>) {
          const where: unknown[] = [];
          const chain = {
            eq(column: string, value: unknown) {
              where.push([column, value]);
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              updates.push({ table, values, where });
              return { data: { id: "row" }, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
  return { admin: client as never, updates };
}

const PRICES = { basic: "price_basic", pro: "price_pro" };

describe("[P6-6] applySubscriptionEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("결제가 끝나면 등급을 올리고 활성 상태로 바꾼다", async () => {
    const { admin, updates } = fakeAdmin();

    await applySubscriptionEvent(admin, PRICES, {
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user-1",
          customer: "cus_123",
          subscription: "sub_123",
          // Checkout 완료 시점엔 가격이 line_items에 있지 않을 수 있어
          // 메타데이터로도 받을 수 있게 한다
          metadata: { price_id: "price_pro" },
        },
      },
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("profiles");
    expect(updates[0].where).toContainEqual(["id", "user-1"]);
    expect(updates[0].values).toMatchObject({
      grade: "pro",
      subscription_status: "active",
      stripe_customer_id: "cus_123",
    });
  });

  it("구독이 갱신되면 상태와 등급을 따라 맞춘다", async () => {
    const { admin, updates } = fakeAdmin();

    await applySubscriptionEvent(admin, PRICES, {
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_123",
          status: "past_due",
          items: { data: [{ price: { id: "price_basic" } }] },
        },
      },
    });

    expect(updates[0].where).toContainEqual(["stripe_customer_id", "cus_123"]);
    expect(updates[0].values).toMatchObject({ subscription_status: "past_due", grade: "basic" });
  });

  it("해지되면 등급을 체험으로 내린다 (FR-023의 토대)", async () => {
    const { admin, updates } = fakeAdmin();

    await applySubscriptionEvent(admin, PRICES, {
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_123", status: "canceled" } },
    });

    expect(updates[0].values).toMatchObject({
      subscription_status: "canceled",
      grade: "trial",
    });
  });

  it("결제 실패는 미납 상태로 표시한다", async () => {
    const { admin, updates } = fakeAdmin();

    await applySubscriptionEvent(admin, PRICES, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_123" } },
    });

    expect(updates[0].values).toMatchObject({ subscription_status: "past_due" });
  });

  it("모르는 사건은 아무것도 바꾸지 않는다", async () => {
    const { admin, updates } = fakeAdmin();

    await applySubscriptionEvent(admin, PRICES, {
      type: "customer.created",
      data: { object: { customer: "cus_123" } },
    });

    expect(updates).toHaveLength(0);
  });

  it("누구의 결제인지 알 수 없으면 아무것도 바꾸지 않는다", async () => {
    const { admin, updates } = fakeAdmin();

    await applySubscriptionEvent(admin, PRICES, {
      type: "checkout.session.completed",
      data: { object: { customer: "cus_123" } }, // client_reference_id 없음
    });

    expect(updates).toHaveLength(0);
  });

  it("모르는 가격이면 등급은 건드리지 않고 상태만 반영한다", async () => {
    const { admin, updates } = fakeAdmin();

    await applySubscriptionEvent(admin, PRICES, {
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_123",
          status: "active",
          items: { data: [{ price: { id: "price_unknown" } }] },
        },
      },
    });

    expect(updates[0].values).toMatchObject({ subscription_status: "active" });
    expect(updates[0].values).not.toHaveProperty("grade");
  });
});

describe("[P6-7] 구독 사건 → 산출물 잠금·복구", () => {
  it("해지되면 산출물을 잠근다 (FR-023)", async () => {
    const { admin, updates } = fakeAdmin();
    const locked: unknown[] = [];

    await applySubscriptionEvent(
      admin,
      PRICES,
      {
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_123", status: "canceled" } },
      },
      {
        lock: async (...args) => {
          locked.push(args);
          return { lockedCount: 1, purgeAfter: "2026-10-12T00:00:00.000Z" };
        },
        restore: async () => ({ restoredCount: 0 }),
      },
    );

    expect(updates[0].values).toMatchObject({ subscription_status: "canceled" });
    expect(locked).toHaveLength(1);
  });

  it("결제가 끝나면 잠겨 있던 산출물을 되살린다", async () => {
    const { admin } = fakeAdmin();
    const restored: unknown[] = [];

    await applySubscriptionEvent(
      admin,
      PRICES,
      {
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: "user-1",
            customer: "cus_123",
            metadata: { price_id: "price_basic" },
          },
        },
      },
      {
        lock: async () => ({ lockedCount: 0, purgeAfter: "" }),
        restore: async (...args) => {
          restored.push(args);
          return { restoredCount: 1 };
        },
      },
    );

    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual([expect.anything(), "user-1"]);
  });

  it("미납은 잠그지 않는다 (카드만 바꾸면 되는 상황이므로)", async () => {
    const { admin } = fakeAdmin();
    const locked: unknown[] = [];

    await applySubscriptionEvent(
      admin,
      PRICES,
      { type: "invoice.payment_failed", data: { object: { customer: "cus_123" } } },
      {
        lock: async () => {
          locked.push(1);
          return { lockedCount: 0, purgeAfter: "" };
        },
        restore: async () => ({ restoredCount: 0 }),
      },
    );

    expect(locked).toHaveLength(0);
  });
});
