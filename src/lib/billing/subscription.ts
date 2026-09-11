import type { SupabaseClient } from "@supabase/supabase-js";
import type { Grade, SubscriptionStatus } from "@/lib/billing/access";
import {
  lockArtifacts as defaultLock,
  restoreArtifacts as defaultRestore,
} from "@/lib/billing/lifecycle";

/**
 * [P6-6] Stripe 사건 → 우리 등급·구독상태.
 *
 * 이 값이 [P6-4] 차단 판정의 근거이므로, **누구의 결제인지 확실할 때만** 바꾼다.
 * 확실하지 않으면 아무것도 하지 않는다(잘못 올려주면 공짜로 쓰이고,
 * 잘못 내리면 돈 낸 사람이 막힌다).
 */

export interface PriceMap {
  basic: string;
  pro: string;
}

/** Stripe 웹훅 본문에서 우리가 쓰는 부분만. */
export interface StripeEvent {
  type: string;
  data: {
    object: {
      client_reference_id?: string | null;
      customer?: string | null;
      subscription?: string | null;
      status?: string | null;
      metadata?: Record<string, string> | null;
      items?: { data?: { price?: { id?: string } }[] };
    };
  };
}

/** Stripe 구독 상태 → 우리 값. 모르는 값은 미납으로 본다(막히는 쪽). */
function toSubscriptionStatus(status: string | null | undefined): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "past_due";
  }
}

function gradeOfPrice(prices: PriceMap, priceId: string | undefined): Grade | undefined {
  if (!priceId) return undefined;
  if (priceId === prices.basic) return "basic";
  if (priceId === prices.pro) return "pro";
  return undefined; // 모르는 가격 — 등급은 건드리지 않는다
}

function priceIdOf(object: StripeEvent["data"]["object"]): string | undefined {
  return object.metadata?.price_id ?? object.items?.data?.[0]?.price?.id;
}

/**
 * [P6-7] 산출물 잠금·복구는 주입받는다 — 테스트에서 진짜 DB 없이
 * "불렸는지"만 확인할 수 있게 하기 위해서.
 */
export interface LifecycleHooks {
  lock: typeof defaultLock;
  restore: typeof defaultRestore;
}

export async function applySubscriptionEvent(
  admin: SupabaseClient,
  prices: PriceMap,
  event: StripeEvent,
  hooks: LifecycleHooks = { lock: defaultLock, restore: defaultRestore },
): Promise<void> {
  const object = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      // 결제 직후 — 우리 사용자 id가 실려 있어야 누구인지 알 수 있다([P6-5]).
      const userId = object.client_reference_id;
      if (!userId) return;

      const values: Record<string, unknown> = { subscription_status: "active" };
      if (object.customer) values.stripe_customer_id = object.customer;
      const grade = gradeOfPrice(prices, priceIdOf(object));
      if (grade) values.grade = grade;

      await update(admin, values, ["id", userId]);
      // [P6-7] 유예 중이었다면 원래 공개범위 그대로 되살린다 (FR-023).
      await hooks.restore(admin, userId);
      return;
    }

    case "customer.subscription.updated": {
      if (!object.customer) return;
      const values: Record<string, unknown> = {
        subscription_status: toSubscriptionStatus(object.status),
      };
      const grade = gradeOfPrice(prices, priceIdOf(object));
      if (grade) values.grade = grade;

      await update(admin, values, ["stripe_customer_id", object.customer]);
      return;
    }

    case "customer.subscription.deleted": {
      if (!object.customer) return;
      // 해지되면 체험 등급으로 내린다. 접근 자체는 상태(canceled)로 막히지만,
      // 등급을 남겨두면 나중에 한도 계산이 어긋난다.
      await update(
        admin,
        { subscription_status: "canceled", grade: "trial" },
        ["stripe_customer_id", object.customer],
      );

      // [P6-7] 산출물을 즉시 비공개로 돌리고 30일 유예를 건다 (FR-023).
      // 미납(past_due)에는 하지 않는다 — 카드만 다시 넣으면 되는 상황이라
      // 남의 홈페이지를 성급히 내려버리면 안 된다.
      const userId = await findUserIdByCustomer(admin, object.customer);
      if (userId) await hooks.lock(admin, userId, "canceled");
      return;
    }

    case "invoice.payment_failed": {
      if (!object.customer) return;
      await update(admin, { subscription_status: "past_due" }, [
        "stripe_customer_id",
        object.customer,
      ]);
      return;
    }

    default:
      // 우리가 쓰지 않는 사건은 조용히 넘긴다 (Stripe는 사건을 아주 많이 보낸다).
      return;
  }
}

/** 고객 id로 우리 사용자 id를 찾는다. 없으면 null(아무것도 하지 않는다). */
async function findUserIdByCustomer(
  admin: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return (data as { id?: string } | null)?.id ?? null;
}

async function update(
  admin: SupabaseClient,
  values: Record<string, unknown>,
  [column, value]: [string, string],
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update(values)
    .eq(column, value)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`구독 상태 반영 실패: ${error.message}`);
}
