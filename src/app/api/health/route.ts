import { NextResponse } from "next/server";

/**
 * [P2-3] 환경변수·Supabase 연결 확인용 헬스체크.
 * 실제 키 값은 절대 응답에 포함하지 않는다 — 설정 여부(boolean)만 반환한다.
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const result: {
    supabaseUrlConfigured: boolean;
    supabaseKeyConfigured: boolean;
    supabaseReachable: boolean | null;
    anthropicKeyConfigured: boolean;
  } = {
    supabaseUrlConfigured: Boolean(supabaseUrl),
    supabaseKeyConfigured: Boolean(supabaseKey),
    supabaseReachable: null,
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  if (supabaseUrl && supabaseKey) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: { apikey: supabaseKey },
        cache: "no-store",
      });
      result.supabaseReachable = res.ok;
    } catch {
      result.supabaseReachable = false;
    }
  }

  return NextResponse.json(result);
}
