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
    /** [BL-008] 서버관리자 자동 승격이 가능한 설정인지 — 값은 노출하지 않는다 */
    adminEmailConfigured: boolean;
  } = {
    supabaseUrlConfigured: Boolean(supabaseUrl),
    supabaseKeyConfigured: Boolean(supabaseKey),
    supabaseReachable: null,
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    adminEmailConfigured: Boolean(process.env.ADMIN_EMAIL),
  };

  if (supabaseUrl && supabaseKey) {
    try {
      // /auth/v1/health는 publishable key로 접근 가능한 공개 헬스체크 엔드포인트.
      // /rest/v1/(PostgREST 스키마)는 secret key가 있어야 응답하므로 여기서는 쓰지 않는다.
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
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
