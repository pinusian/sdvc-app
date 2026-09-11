/**
 * [P6-8] Stripe 고객 포털 세션.
 *
 * 해지·결제수단 변경·영수증 내려받기를 우리가 직접 만들지 않는 이유:
 * 그 화면들은 전부 카드·청구 정보를 다루고, 잘못 만들면 돈 문제가 된다.
 * Stripe 포털로 보내면 Stripe가 처리하고 결과는 웹훅([P6-6])으로 돌아온다.
 */

const STRIPE_API = "https://api.stripe.com/v1";

export interface PortalInput {
  secretKey: string;
  /** Stripe 쪽 고객 id — 결제한 적이 있어야 존재한다 */
  customerId: string;
  /** 포털에서 볼일을 마치고 돌아올 우리 주소 */
  returnUrl: string;
  fetchImpl?: typeof fetch;
}

export interface PortalSession {
  url: string;
}

export async function createPortalSession({
  secretKey,
  customerId,
  returnUrl,
  fetchImpl = fetch,
}: PortalInput): Promise<PortalSession> {
  const form = new URLSearchParams({ customer: customerId, return_url: returnUrl });

  const res = await fetchImpl(`${STRIPE_API}/billing_portal/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const body = (await res.json().catch(() => null)) as
    | { url?: string; error?: { message?: string } }
    | null;

  if (!res.ok) {
    throw new Error(`구독 관리 화면을 열지 못했습니다: ${body?.error?.message ?? `상태 ${res.status}`}`);
  }
  if (!body?.url) {
    throw new Error("구독 관리 화면 주소를 받지 못했습니다.");
  }

  return { url: body.url };
}
