import type { SupabaseClient } from "@supabase/supabase-js";

export type LoginResult = { success: true } | { success: false; error: string };

/**
 * [P2-5] 개발자 로그인. Supabase 클라이언트를 주입받아 테스트 가능하게 한다.
 */
export async function loginDeveloper(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<LoginResult> {
  if (!email || !password) {
    return { success: false, error: "이메일과 비밀번호를 입력해주세요." };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
