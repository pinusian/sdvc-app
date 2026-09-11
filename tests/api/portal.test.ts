import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * [P6-8] POST /api/billing/portal — 구독 관리(해지·결제수단·영수증).
 *
 * 우리는 "이 사람의 Stripe 고객 id"만 확인하고 포털 주소를 받아 넘긴다.
 * 남의 고객 id로는 절대 열 수 없어야 한다 — 청구 정보가 통째로 보이기 때문이다.
 */

const getUser = vi.fn();
const createPortalSession = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

vi.mock("@/lib/billing/portal", () => ({
  createPortalSession: (...args: unknown[]) => createPortalSession(...args),
}));

function request() {
  return new Request("http://localhost:3000/api/billing/portal", { method: "POST" });
}

describe("[P6-8] POST /api/billing/portal", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    maybeSingle.mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null });
    createPortalSession.mockResolvedValue({ url: "https://billing.stripe.com/p/session/1" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { POST } = await import("@/app/api/billing/portal/route");
    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it("본인 고객 id로 포털 주소를 준다", async () => {
    const { POST } = await import("@/app/api/billing/portal/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://billing.stripe.com/p/session/1" });
    expect(createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_123", secretKey: "sk_test_x" }),
    );
  });

  it("결제한 적이 없으면 400 (열 포털이 없다)", async () => {
    maybeSingle.mockResolvedValue({ data: { stripe_customer_id: null }, error: null });

    const { POST } = await import("@/app/api/billing/portal/route");
    const res = await POST(request());

    expect(res.status).toBe(400);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it("Stripe 설정이 없으면 500이고 키를 노출하지 않는다", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const { POST } = await import("@/app/api/billing/portal/route");
    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("sk_test");
  });

  it("Stripe가 실패하면 502로 알린다", async () => {
    createPortalSession.mockRejectedValue(new Error("No such customer"));

    const { POST } = await import("@/app/api/billing/portal/route");
    const res = await POST(request());

    expect(res.status).toBe(502);
  });
});
