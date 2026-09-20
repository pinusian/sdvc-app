import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  requestPasswordReset,
  updateDeveloperPassword,
  validatePasswordUpdate,
} from "@/lib/auth/reset";

/**
 * [BL-030] 개발자·시스템관리자 비밀번호 찾기 — 이 둘은 같은 Supabase Auth
 * 계정 하나를 공유한다(관리자 화면은 착지점만 다르다, [P8-11c]). Supabase가
 * 이미 이 프로젝트의 이메일(가입 확인 메일)을 실제로 보내고 있으므로,
 * Supabase 내장 `resetPasswordForEmail`/`updateUser`를 그대로 쓴다 —
 * 새 이메일 발송 수단을 만들 필요가 없다.
 */

function fakeSupabase(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  return {
    auth: {
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      ...overrides,
    },
  } as unknown as SupabaseClient;
}

describe("[BL-030] requestPasswordReset", () => {
  it("이메일 형식이 아니면 Supabase를 호출하지 않는다", async () => {
    const supabase = fakeSupabase();
    const result = await requestPasswordReset(supabase, "not-an-email", "https://x/update-password");

    expect(result.success).toBe(false);
    expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("정상 이메일이면 resetPasswordForEmail을 그 redirectTo로 부른다", async () => {
    const supabase = fakeSupabase();
    const result = await requestPasswordReset(supabase, "dev@example.com", "https://x/update-password");

    expect(result.success).toBe(true);
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith("dev@example.com", {
      redirectTo: "https://x/update-password",
    });
  });

  it("계정이 없는 이메일이어도 Supabase 응답을 그대로 성공으로 받아들인다 — 계정 존재 여부를 드러내지 않는다", async () => {
    // Supabase 자신이 이미 이렇게 동작한다(계정 유무와 무관하게 error 없이 응답) — 그 값을 그대로 믿는다.
    const supabase = fakeSupabase({ resetPasswordForEmail: async () => ({ data: {}, error: null }) });
    const result = await requestPasswordReset(supabase, "no-such-account@example.com", "https://x/update-password");
    expect(result.success).toBe(true);
  });

  it("Supabase가 진짜 오류(형식 아닌 다른 이유)를 주면 그대로 전달한다", async () => {
    const supabase = fakeSupabase({
      resetPasswordForEmail: async () => ({ data: null, error: { message: "요청이 너무 잦습니다." } }),
    });
    const result = await requestPasswordReset(supabase, "dev@example.com", "https://x/update-password");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("요청이 너무 잦습니다.");
  });
});

describe("[BL-030] validatePasswordUpdate — 새 비밀번호 두 칸이 서로 맞는지, 길이가 되는지", () => {
  it("두 칸이 다르면 실패한다", () => {
    const result = validatePasswordUpdate("password123", "password456");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("다릅니다");
  });

  it("8자 미만이면 실패한다", () => {
    const result = validatePasswordUpdate("short", "short");
    expect(result.valid).toBe(false);
  });

  it("일치하고 8자 이상이면 통과한다", () => {
    const result = validatePasswordUpdate("password123", "password123");
    expect(result.valid).toBe(true);
  });
});

describe("[BL-030] updateDeveloperPassword", () => {
  it("검증에서 걸리면 Supabase를 호출하지 않는다", async () => {
    const supabase = fakeSupabase();
    const result = await updateDeveloperPassword(supabase, "short");

    expect(result.success).toBe(false);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("유효하면 updateUser를 부르고 성공을 돌려준다", async () => {
    const supabase = fakeSupabase();
    const result = await updateDeveloperPassword(supabase, "newpassword1");

    expect(result.success).toBe(true);
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "newpassword1" });
  });

  it("Supabase가 오류를 주면(예: 만료된 링크) 그대로 전달한다", async () => {
    const supabase = fakeSupabase({
      updateUser: async () => ({ data: null, error: { message: "세션이 만료되었습니다." } }),
    });
    const result = await updateDeveloperPassword(supabase, "newpassword1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("세션이 만료되었습니다.");
  });
});
