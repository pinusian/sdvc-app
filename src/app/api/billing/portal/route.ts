import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { createPortalSession } from "@/lib/billing/portal";

/**
 * [P6-8] 구독 관리 — Stripe 고객 포털로 보낸다 (FR-023 해지 경로).
 *
 * 고객 id는 **로그인한 본인의 프로필에서만** 읽는다. 클라이언트가 보낸 값을
 * 쓰면 남의 청구 내역을 통째로 열 수 있다.
 */

export async function POST(request: Request) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { user } = access;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json(
      { error: "서버에 결제 설정이 되어 있지 않습니다. 관리자에게 문의해주세요." },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const customerId = (profile as { stripe_customer_id?: string | null } | null)
    ?.stripe_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { error: "구독 정보를 찾을 수 없습니다. 먼저 요금제를 결제해주세요." },
      { status: 400 },
    );
  }

  try {
    const session = await createPortalSession({
      secretKey,
      customerId,
      returnUrl: `${new URL(request.url).origin}/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "구독 관리 화면을 열지 못했습니다.",
      },
      { status: 502 },
    );
  }
}
