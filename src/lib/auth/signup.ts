import type { SupabaseClient } from "@supabase/supabase-js";
import { validateSignupInput } from "./validation";

export type SignupResult = { success: true } | { success: false; error: string };

/**
 * [P2-5] 개발자 회원가입.
 * Supabase 클라이언트를 인자로 받아서(의존성 주입), 실제 네트워크 호출 없이 테스트할 수 있게 한다.
 * 이메일 인증(FR-021)은 Supabase Auth의 emailRedirectTo 옵션으로 처리 —
 * 가입 직후 로그인되지 않고, 이메일의 링크를 눌러야 활성화된다.
 */
export async function signUpDeveloper(
  supabase: SupabaseClient,
  email: string,
  password: string,
  emailRedirectTo: string,
): Promise<SignupResult> {
  const validation = validateSignupInput(email, password);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
