import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loginDeveloper } from "@/lib/auth/login";

function fakeSupabase(signInImpl: (...args: unknown[]) => unknown) {
  return {
    auth: { signInWithPassword: vi.fn(signInImpl) },
  } as unknown as SupabaseClient;
}

describe("[P2-5] loginDeveloper", () => {
  it("이메일 또는 비밀번호가 비어있으면 Supabase를 호출하지 않는다", async () => {
    const signIn = vi.fn();
    const supabase = fakeSupabase(signIn);

    const result = await loginDeveloper(supabase, "", "password123");

    expect(result.success).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("정상 입력이면 signInWithPassword를 호출하고 성공을 반환한다", async () => {
    const supabase = fakeSupabase(async () => ({ data: {}, error: null }));

    const result = await loginDeveloper(supabase, "dev@example.com", "password123");

    expect(result.success).toBe(true);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "dev@example.com",
      password: "password123",
    });
  });

  it("Supabase가 인증 오류를 반환하면 그대로 전달한다", async () => {
    const supabase = fakeSupabase(async () => ({
      data: null,
      error: { message: "Invalid login credentials" },
    }));

    const result = await loginDeveloper(supabase, "dev@example.com", "wrong-password");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Invalid login credentials");
  });
});
