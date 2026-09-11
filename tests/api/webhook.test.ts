import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

/**
 * [P6-6] POST /api/billing/webhook — Stripe가 결제 결과를 알려오는 문.
 * **서명이 맞지 않으면 아무것도 하지 않는다.**
 */

const applySubscriptionEvent = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/billing/subscription", () => ({
  applySubscriptionEvent: (...args: unknown[]) => applySubscriptionEvent(...args),
}));

const SECRET = "whsec_test_secret";

function signed(payload: string, secret = SECRET, timestampSec = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSec}.${payload}`)
    .digest("hex");
  return new Request("http://localhost:3000/api/billing/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": `t=${timestampSec},v1=${signature}`,
      "content-type": "application/json",
    },
    body: payload,
  });
}

describe("[P6-6] POST /api/billing/webhook", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_PRICE_BASIC = "price_basic";
    process.env.STRIPE_PRICE_PRO = "price_pro";
    applySubscriptionEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("올바른 서명이면 사건을 처리하고 200을 준다", async () => {
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "user-1", customer: "cus_1" } },
    });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(signed(payload));

    expect(res.status).toBe(200);
    expect(applySubscriptionEvent).toHaveBeenCalledWith(
      expect.anything(),
      { basic: "price_basic", pro: "price_pro" },
      expect.objectContaining({ type: "checkout.session.completed" }),
    );
  });

  it("서명이 틀리면 400이고 아무것도 처리하지 않는다", async () => {
    const payload = JSON.stringify({ type: "checkout.session.completed" });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(signed(payload, "whsec_attacker"));

    expect(res.status).toBe(400);
    expect(applySubscriptionEvent).not.toHaveBeenCalled();
  });

  it("서명 헤더가 아예 없으면 400", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(
      new Request("http://localhost:3000/api/billing/webhook", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(res.status).toBe(400);
    expect(applySubscriptionEvent).not.toHaveBeenCalled();
  });

  it("서버에 웹훅 비밀키가 없으면 500이고 처리하지 않는다", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const payload = JSON.stringify({ type: "checkout.session.completed" });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(signed(payload));

    expect(res.status).toBe(500);
    expect(applySubscriptionEvent).not.toHaveBeenCalled();
  });

  it("처리 중 오류가 나도 Stripe에는 500으로 알려 재시도하게 한다", async () => {
    applySubscriptionEvent.mockRejectedValue(new Error("db down"));
    const payload = JSON.stringify({ type: "checkout.session.completed" });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(signed(payload));

    // 200을 주면 Stripe가 "처리됐다"고 보고 다시 안 보낸다 — 결제가 유실된다
    expect(res.status).toBe(500);
  });
});
