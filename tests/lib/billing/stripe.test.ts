import { describe, expect, it, vi } from "vitest";
import { createCheckoutSession } from "@/lib/billing/stripe";

/**
 * [P6-5] Stripe Checkout 세션 만들기.
 *
 * 카드번호는 Stripe 결제창이 직접 받는다 — 우리 서버는 카드정보를 보지도
 * 저장하지도 않는다. 우리가 하는 일은 "이 사람이 이 요금제를 결제하려 한다"는
 * 세션을 만들고 그 주소로 보내는 것뿐이다.
 *
 * fetch를 주입받아 실제 네트워크 없이 검증한다([P3-2]와 같은 구조).
 */

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("[P6-5] createCheckoutSession", () => {
  it("구독 결제 세션을 만들어 결제창 주소를 돌려준다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }));

    const session = await createCheckoutSession({
      secretKey: "sk_test_secret",
      priceId: "price_basic",
      userId: "user-1",
      userEmail: "dev@example.com",
      successUrl: "https://sdvc.app/billing/done",
      cancelUrl: "https://sdvc.app/pricing",
      fetchImpl,
    });

    expect(session).toEqual({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_test_secret");
    expect(init.headers["content-type"]).toContain("application/x-www-form-urlencoded");

    const form = new URLSearchParams(init.body as string);
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("line_items[0][price]")).toBe("price_basic");
    expect(form.get("line_items[0][quantity]")).toBe("1");
    expect(form.get("success_url")).toBe("https://sdvc.app/billing/done");
    expect(form.get("cancel_url")).toBe("https://sdvc.app/pricing");
    // 웹훅에서 "누구의 결제인지" 알아내려면 우리 쪽 사용자 id가 실려야 한다
    expect(form.get("client_reference_id")).toBe("user-1");
    expect(form.get("customer_email")).toBe("dev@example.com");
    // [P6-6 검증에서 발견] 결제 완료 이벤트에는 "어떤 가격을 샀는지"가 담겨
    // 오지 않는다 — 실제로 결제했는데 등급이 안 올라갔다.
    // 메타데이터에 가격을 실어 보내야 웹훅이 등급을 판단할 수 있다.
    expect(form.get("metadata[price_id]")).toBe("price_basic");
    expect(form.get("subscription_data[metadata][price_id]")).toBe("price_basic");
  });

  it("Stripe가 거절하면 이유를 알리되 키는 노출하지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "No such price: price_x" } }),
    } as unknown as Response);

    await expect(
      createCheckoutSession({
        secretKey: "sk_test_super_secret",
        priceId: "price_x",
        userId: "user-1",
        userEmail: "dev@example.com",
        successUrl: "https://sdvc.app/done",
        cancelUrl: "https://sdvc.app/pricing",
        fetchImpl,
      }),
    ).rejects.toThrow(/No such price/);

    await expect(
      createCheckoutSession({
        secretKey: "sk_test_super_secret",
        priceId: "price_x",
        userId: "user-1",
        userEmail: "dev@example.com",
        successUrl: "https://sdvc.app/done",
        cancelUrl: "https://sdvc.app/pricing",
        fetchImpl,
      }),
    ).rejects.not.toThrow(/sk_test_super_secret/);
  });

  it("결제창 주소가 없으면 오류로 본다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ id: "cs_test_1" }));

    await expect(
      createCheckoutSession({
        secretKey: "sk_test_x",
        priceId: "price_basic",
        userId: "user-1",
        userEmail: "dev@example.com",
        successUrl: "https://sdvc.app/done",
        cancelUrl: "https://sdvc.app/pricing",
        fetchImpl,
      }),
    ).rejects.toThrow();
  });
});
