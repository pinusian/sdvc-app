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
    /** [P11-1] 사용자(방문자) API 키 암호화 열쇠가 설정됐는지 — 값은 노출하지 않는다 */
    siteApiKeyEncryptionSecretConfigured: boolean;
    /**
     * [P8-12] 지금 돌고 있는 배포의 커밋(짧게). 로컬에서는 null.
     *
     * "고쳤는데 반영이 됐나"를 두 번 추측으로 때웠다([BL-006]·[BL-010]).
     * 공개해도 되는 값이다 — 저장소가 어차피 공개이고, 이것 하나로
     * 배포 지연과 코드 결함을 구별할 수 있다.
     */
    commit: string | null;
  } = {
    supabaseUrlConfigured: Boolean(supabaseUrl),
    supabaseKeyConfigured: Boolean(supabaseKey),
    supabaseReachable: null,
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    adminEmailConfigured: Boolean(process.env.ADMIN_EMAIL),
    siteApiKeyEncryptionSecretConfigured: Boolean(process.env.SITE_API_KEY_ENCRYPTION_SECRET),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
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
