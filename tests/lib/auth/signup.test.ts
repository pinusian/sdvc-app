import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signUpDeveloper } from "@/lib/auth/signup";

function fakeSupabase(signUpImpl: (...args: unknown[]) => unknown) {
  return {
    auth: { signUp: vi.fn(signUpImpl) },
  } as unknown as SupabaseClient;
}

describe("[P2-5] signUpDeveloper", () => {
  it("유효하지 않은 입력이면 Supabase를 호출하지 않고 즉시 실패를 반환한다", async () => {
    const signUp = vi.fn();
    const supabase = fakeSupabase(signUp);

    const result = await signUpDeveloper(supabase, "bad-email", "short", "https://sdvc.app/verify-email");

    expect(result.success).toBe(false);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("유효한 입력이면 Supabase auth.signUp을 emailRedirectTo와 함께 호출한다", async () => {
    const supabase = fakeSupabase(async () => ({ data: {}, error: null }));

    const result = await signUpDeveloper(
      supabase,
      "dev@example.com",
      "password123",
      "https://sdvc.app/verify-email",
    );

    expect(result.success).toBe(true);
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: "dev@example.com",
      password: "password123",
      options: { emailRedirectTo: "https://sdvc.app/verify-email" },
    });
  });

  it("Supabase가 오류를 반환하면 그 메시지를 그대로 전달한다", async () => {
    const supabase = fakeSupabase(async () => ({
      data: null,
      error: { message: "User already registered" },
    }));

    const result = await signUpDeveloper(
      supabase,
      "dev@example.com",
      "password123",
      "https://sdvc.app/verify-email",
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("User already registered");
  });
});
