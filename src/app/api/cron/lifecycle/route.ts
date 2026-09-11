import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runLifecycleSweep } from "@/lib/billing/purge";

/**
 * [P6-7b] 하루 한 번 도는 정리 작업 (Vercel Cron이 부른다).
 *
 * 체험 만료자 잠금(FR-027) + 유예 만료자 삭제(FR-023).
 * 공개 주소이므로 **비밀 열쇠 없이는 돌지 않는다** — 누구나 부를 수 있으면
 * 남의 산출물 삭제를 앞당기는 데 쓰일 수 있다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // 설정이 없으면 열린 채로 두지 않는다.
    return NextResponse.json({ error: "정리 작업 설정이 없습니다." }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  const result = await runLifecycleSweep(createAdminClient());
  return NextResponse.json(result);
}
