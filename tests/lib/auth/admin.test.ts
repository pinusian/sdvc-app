import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAdminRole, hasVerifiedMfa } from "@/lib/auth/admin";

function fakeAdminClient(updateResult: { error: { message: string } | null }) {
  const eq = vi.fn().mockResolvedValue(updateResult);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { client: { from } as unknown as SupabaseClient, from, update, eq };
}

describe("[P2-7] ensureAdminRole — FR-024", () => {
  it("ADMIN_EMAIL이 설정되지 않았으면 아무것도 하지 않는다", async () => {
    const { client, from } = fakeAdminClient({ error: null });
    const result = await ensureAdminRole(client, "user-1", "dev@example.com", undefined);
    expect(result.promoted).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("이메일이 ADMIN_EMAIL과 다르면 승격하지 않는다", async () => {
    const { client, from } = fakeAdminClient({ error: null });
    const result = await ensureAdminRole(client, "user-1", "dev@example.com", "admin@sdvc.app");
    expect(result.promoted).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("이메일이 ADMIN_EMAIL과 일치하면(대소문자 무관) profiles.role을 admin으로 갱신한다", async () => {
    const { client, from, update, eq } = fakeAdminClient({ error: null });
    const result = await ensureAdminRole(client, "user-1", "Admin@SDVC.app", "admin@sdvc.app");

    expect(result.promoted).toBe(true);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(update).toHaveBeenCalledWith({ role: "admin" });
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("갱신 중 오류가 나면 예외를 던진다", async () => {
    const { client } = fakeAdminClient({ error: { message: "db error" } });
    await expect(
      ensureAdminRole(client, "user-1", "admin@sdvc.app", "admin@sdvc.app"),
    ).rejects.toThrow("db error");
  });
});

describe("[P2-7] hasVerifiedMfa — 2FA 검사 (WBS P2-7)", () => {
  it("세션이 없으면 false", () => {
    expect(hasVerifiedMfa(null)).toBe(false);
  });

  it("aal1(비밀번호만)이면 false", () => {
    expect(hasVerifiedMfa({ aal: "aal1" })).toBe(false);
  });

  it("aal2(2단계 인증 완료)이면 true", () => {
    expect(hasVerifiedMfa({ aal: "aal2" })).toBe(true);
  });
});
