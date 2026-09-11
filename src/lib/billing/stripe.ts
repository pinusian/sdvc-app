/**
 * [P6-5] Stripe 호출 — 필요한 것만 얇게 감싼다.
 *
 * SDK를 쓰지 않고 REST API를 직접 부르는 이유: 우리가 쓰는 기능이 두어 개뿐이고,
 * `fetch`를 주입받는 구조([P3-2] Claude 호출과 동일)로 두면 실제 네트워크 없이
 * 테스트할 수 있기 때문이다.
 *
 * **카드정보는 우리 서버를 지나가지 않는다.** Stripe 결제창이 직접 받는다.
 */

const STRIPE_API = "https://api.stripe.com/v1";

export interface CheckoutInput {
  secretKey: string;
  priceId: string;
  /** 우리 쪽 사용자 id — 웹훅에서 "누구의 결제인지" 알아내는 열쇠 */
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
  fetchImpl?: typeof fetch;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export async function createCheckoutSession({
  secretKey,
  priceId,
  userId,
  userEmail,
  successUrl,
  cancelUrl,
  fetchImpl = fetch,
}: CheckoutInput): Promise<CheckoutSession> {
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: userId,
    customer_email: userEmail,
  });

  const res = await fetchImpl(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const body = (await res.json().catch(() => null)) as
    | { id?: string; url?: string; error?: { message?: string } }
    | null;

  if (!res.ok) {
    // 응답에 우리 키가 들어 있지는 않지만, Stripe 메시지만 옮기고 끝낸다.
    throw new Error(`결제 준비에 실패했습니다: ${body?.error?.message ?? `상태 ${res.status}`}`);
  }
  if (!body?.id || !body.url) {
    throw new Error("결제창 주소를 받지 못했습니다.");
  }

  return { id: body.id, url: body.url };
}
