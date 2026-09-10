export type ValidationResult = { valid: true } | { valid: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * [P2-5] 회원가입 입력값 검증 (순수 함수, Supabase 호출 전에 먼저 걸러낸다).
 */
export function validateSignupInput(email: string, password: string): ValidationResult {
  if (!email || !EMAIL_RE.test(email)) {
    return { valid: false, error: "올바른 이메일 주소를 입력해주세요." };
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` };
  }
  return { valid: true };
}
