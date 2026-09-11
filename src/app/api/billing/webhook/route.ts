import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyStripeSignature } from "@/lib/billing/webhook";
import { applySubscriptionEvent, type StripeEvent } from "@/lib/billing/subscription";

/**
 * [P6-6] Stripe가 결제 결과를 알려오는 문.
 *
 * 로그인 검사가 없는 공개 엔드포인트이므로 **서명 검증이 유일한 방어선**이다.
 * 서명이 맞지 않으면 본문을 읽지도, 아무것도 바꾸지도 않는다.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // 설정이 빠진 채로 열려 있으면 안 된다 — 막고 알린다(값은 노출하지 않음).
    return NextResponse.json({ error: "웹훅 설정이 없습니다." }, { status: 500 });
  }

  // 서명은 **파싱 전 원문**으로 계산해야 맞는다.
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!verifyStripeSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "서명을 확인할 수 없습니다." }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "본문을 읽을 수 없습니다." }, { status: 400 });
  }

  const prices = {
    basic: process.env.STRIPE_PRICE_BASIC ?? "",
    pro: process.env.STRIPE_PRICE_PRO ?? "",
  };

  try {
    await applySubscriptionEvent(createAdminClient(), prices, event);
  } catch {
    // 여기서 200을 주면 Stripe는 "처리됐다"고 보고 다시 보내지 않는다 —
    // 결제가 반영되지 않은 채 유실된다. 500을 줘서 재시도하게 한다.
    return NextResponse.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
