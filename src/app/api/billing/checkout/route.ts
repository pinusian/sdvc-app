import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/billing/stripe";

/**
 * [P6-5] 결제 시작 — 요금제를 고르면 Stripe 결제창 주소를 돌려준다.
 *
 * 가격 id는 **서버 환경변수에서만** 가져온다. 클라이언트가 보낸 값을 그대로
 * 쓰면 아무 가격이나(예: $0짜리) 끼워넣을 수 있기 때문이다.
 */

/** 고를 수 있는 요금제 → 환경변수 이름 */
const PLAN_PRICE_ENV: Record<string, string> = {
  basic: "STRIPE_PRICE_BASIC",
  pro: "STRIPE_PRICE_PRO",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let plan: unknown;
  try {
    ({ plan } = (await request.json()) as { plan?: unknown });
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const priceEnv = typeof plan === "string" ? PLAN_PRICE_ENV[plan] : undefined;
  if (!priceEnv) {
    return NextResponse.json(
      { error: "고를 수 있는 요금제가 아닙니다." },
      { status: 400 },
    );
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[priceEnv];
  if (!secretKey || !priceId) {
    // 어떤 설정이 비었는지까지만 알리고 값은 절대 노출하지 않는다.
    return NextResponse.json(
      { error: "서버에 결제 설정이 되어 있지 않습니다. 관리자에게 문의해주세요." },
      { status: 500 },
    );
  }

  const origin = new URL(request.url).origin;

  try {
    const session = await createCheckoutSession({
      secretKey,
      priceId,
      userId: user.id,
      userEmail: user.email ?? "",
      // 결제를 마치면 대시보드로, 도중에 그만두면 요금제 화면으로 돌아온다.
      successUrl: `${origin}/dashboard?checkout=success`,
      cancelUrl: `${origin}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "결제를 시작하지 못했습니다." },
      { status: 502 },
    );
  }
}
