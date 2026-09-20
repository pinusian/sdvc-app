import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * [BL-030] 개발자·시스템관리자 비밀번호 찾기.
 *
 * 이 둘은 같은 Supabase Auth 계정 하나를 공유한다([P8-11c] — 관리자 화면은
 * 로그인 뒤 착지점만 다르다). Supabase가 이미 이 프로젝트의 가입 확인
 * 메일을 실제로 보내고 있으므로(`/verify-email` 흐름), 새 이메일 발송
 * 수단을 만들지 않고 Supabase 내장 `resetPasswordForEmail`/`updateUser`를
 * 그대로 쓴다.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export type RequestResetResult = { success: true } | { success: false; error: string };

/**
 * 재설정 메일 발송을 요청한다. **계정이 없는 이메일이어도 성공으로
 * 응답한다** — Supabase 자신이 이미 그렇게 동작한다(계정 존재 여부를
 * 밝히지 않는다, 로그인의 anti-enumeration과 같은 원칙).
 */
export async function requestPasswordReset(
  supabase: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<RequestResetResult> {
  if (!email || !EMAIL_RE.test(email)) {
    return { success: false, error: "올바른 이메일 주소를 입력해주세요." };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

export type ValidationResult = { valid: true } | { valid: false; error: string };

/** 새 비밀번호 두 칸(본인 확인용)이 맞는지, 길이가 되는지 — 순수 함수. */
export function validatePasswordUpdate(password: string, confirm: string): ValidationResult {
  if (password !== confirm) {
    return { valid: false, error: "두 비밀번호가 서로 다릅니다." };
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` };
  }
  return { valid: true };
}

export type UpdatePasswordResult = { success: true } | { success: false; error: string };

/**
 * 재설정 메일의 링크를 눌러 생긴 임시 세션으로 새 비밀번호를 정한다.
 * (그 세션이 살아있는지는 페이지 쪽에서 먼저 확인한다 — 여기서는 값만 다룬다.)
 */
export async function updateDeveloperPassword(
  supabase: SupabaseClient,
  newPassword: string,
): Promise<UpdatePasswordResult> {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}
