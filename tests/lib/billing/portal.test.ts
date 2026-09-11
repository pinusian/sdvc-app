import { describe, expect, it, vi } from "vitest";
import { createPortalSession } from "@/lib/billing/portal";

/**
 * [P6-8] 구독 관리(해지·결제수단 변경·영수증)는 Stripe 고객 포털에 맡긴다.
 *
 * 직접 만들면 카드정보·영수증까지 우리가 떠안게 된다. 포털로 보내면
 * 해지와 영수증을 Stripe가 처리하고, 결과는 웹훅([P6-6])으로 우리에게 온다.
 */

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("[P6-8] createPortalSession", () => {
  it("고객 포털 주소를 돌려준다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse({ url: "https://billing.stripe.com/p/session/test_1" }));

    const session = await createPortalSession({
      secretKey: "sk_test_secret",
      customerId: "cus_123",
      returnUrl: "https://sdvc.app/dashboard",
      fetchImpl,
    });

    expect(session.url).toBe("https://billing.stripe.com/p/session/test_1");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_test_secret");

    const form = new URLSearchParams(init.body as string);
    expect(form.get("customer")).toBe("cus_123");
    expect(form.get("return_url")).toBe("https://sdvc.app/dashboard");
  });

  it("Stripe가 거절하면 이유를 담아 던진다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "No such customer" } }),
    } as unknown as Response);

    await expect(
      createPortalSession({
        secretKey: "sk_test_secret",
        customerId: "cus_없음",
        returnUrl: "https://sdvc.app/dashboard",
        fetchImpl,
      }),
    ).rejects.toThrow(/No such customer/);
  });

  it("주소가 안 오면 성공으로 치지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({}));

    await expect(
      createPortalSession({
        secretKey: "sk_test_secret",
        customerId: "cus_123",
        returnUrl: "https://sdvc.app/dashboard",
        fetchImpl,
      }),
    ).rejects.toThrow(/주소/);
  });
});
