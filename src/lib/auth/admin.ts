import type { SupabaseClient } from "@supabase/supabase-js";

export type EnsureAdminResult = { promoted: boolean };

/**
 * [P2-7] FR-024 — 로그인/가입 직후 호출한다. 이메일이 ADMIN_EMAIL 환경변수와
 * 일치하면 profiles.role을 'admin'으로 올린다.
 *
 * 반드시 secret key(관리자 권한) 클라이언트로 호출해야 한다 — RLS는 이제
 * profiles에 대한 클라이언트 측 update를 전부 막아뒀다([P2-4]→[P2-7] 보안 수정).
 */
export async function ensureAdminRole(
  adminClient: SupabaseClient,
  userId: string,
  email: string,
  adminEmail: string | undefined,
): Promise<EnsureAdminResult> {
  if (!adminEmail) return { promoted: false };
  if (email.toLowerCase() !== adminEmail.toLowerCase()) return { promoted: false };

  const { error } = await adminClient.from("profiles").update({ role: "admin" }).eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return { promoted: true };
}

/**
 * [P2-7] 2FA 검사 — Supabase 세션의 AAL(Authenticator Assurance Level)이
 * 'aal2'(2단계 인증 완료)인지 확인한다. 관리자 전용 화면·행위는 이 검사를
 * 통과해야만 허용한다(실제 강제 배선과 MFA 등록 UI는 [P8-1]에서).
 */
export function hasVerifiedMfa(session: { aal?: string | null } | null): boolean {
  return session?.aal === "aal2";
}
