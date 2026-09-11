import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * [P6-5] POST /api/billing/checkout — 결제 시작.
 * 로그인한 사람이 요금제를 고르면 Stripe 결제창 주소를 돌려준다.
 */

const getUser = vi.fn();
const createCheckoutSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/billing/stripe", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));

function request(body: unknown) {
  return new Request("http://localhost:3000/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P6-5] POST /api/billing/checkout", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_BASIC = "price_basic";
    process.env.STRIPE_PRICE_PRO = "price_pro";
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "dev@example.com" } },
      error: null,
    });
    createCheckoutSession.mockResolvedValue({
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { POST } = await import("@/app/api/billing/checkout/route");
    const res = await POST(request({ plan: "basic" }));

    expect(res.status).toBe(401);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("요금제를 고르면 그 가격으로 결제창 주소를 준다", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    const res = await POST(request({ plan: "pro" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: "price_pro",
        userId: "user-1",
        userEmail: "dev@example.com",
      }),
    );
  });

  it("모르는 요금제는 400 (임의 가격을 못 넣게)", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");

    for (const plan of ["trial", "price_hack", "", null]) {
      const res = await POST(request({ plan }));
      expect(res.status, String(plan)).toBe(400);
    }
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("서버에 Stripe 설정이 없으면 500이고 키를 노출하지 않는다", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const { POST } = await import("@/app/api/billing/checkout/route");
    const res = await POST(request({ plan: "basic" }));

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("sk_test");
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("돌아올 주소는 요청 주소를 기준으로 만든다", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    await POST(request({ plan: "basic" }));

    const args = createCheckoutSession.mock.calls[0][0] as {
      successUrl: string;
      cancelUrl: string;
    };
    expect(args.successUrl).toContain("http://localhost:3000");
    expect(args.cancelUrl).toContain("http://localhost:3000");
  });
});
