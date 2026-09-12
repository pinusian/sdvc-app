import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * [BL-008] 로그인·가입이 서버관리자 자동 승격을 부르는가 (FR-024).
 *
 * `ensureAdminRole`은 [P2-7]에서 만들고 단위 테스트까지 했지만
 * **어디에서도 부르지 않았다.** 함수가 있는 것과 동작하는 것은 다르다 —
 * 그래서 ADMIN_EMAIL로 가입해도 계속 일반 개발자였다.
 */

const getUser = vi.fn();
const loginDeveloper = vi.fn();
const signUpDeveloper = vi.fn();
const ensureAdminRole = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "sdvc-app.vercel.app"]]),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/auth/login", () => ({
  loginDeveloper: (...a: unknown[]) => loginDeveloper(...a),
}));

vi.mock("@/lib/auth/signup", () => ({
  signUpDeveloper: (...a: unknown[]) => signUpDeveloper(...a),
}));

vi.mock("@/lib/auth/admin", () => ({
  ensureAdminRole: (...a: unknown[]) => ensureAdminRole(...a),
}));

function form(email: string, password = "TestPass123!") {
  const data = new FormData();
  data.append("email", email);
  data.append("password", password);
  return data;
}

/** redirect는 던지므로 잡아서 목적지만 돌려준다. */
async function run(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(리다이렉트 없음)";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("[BL-008] loginAction — 관리자 자동 승격 (FR-024)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAIL = "boss@example.com";
    loginDeveloper.mockResolvedValue({ success: true });
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "boss@example.com" } },
      error: null,
    });
    ensureAdminRole.mockResolvedValue({ promoted: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("로그인할 때마다 승격을 시도한다 (이미 만든 계정도 고쳐진다)", async () => {
    const { loginAction } = await import("@/app/(auth)/actions");
    await run(() => loginAction({ error: null }, form("boss@example.com")));

    expect(ensureAdminRole).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "boss@example.com",
      "boss@example.com",
    );
  });

  it("로그인에 실패하면 승격을 시도하지 않는다", async () => {
    loginDeveloper.mockResolvedValue({ success: false, error: "비밀번호가 틀렸습니다." });

    const { loginAction } = await import("@/app/(auth)/actions");
    const result = await loginAction({ error: null }, form("boss@example.com"));

    expect(result).toEqual({ error: "비밀번호가 틀렸습니다." });
    expect(ensureAdminRole).not.toHaveBeenCalled();
  });

  it("승격이 실패해도 로그인은 막지 않는다 (들어가서 문의라도 할 수 있어야 한다)", async () => {
    ensureAdminRole.mockRejectedValue(new Error("DB 오류"));

    const { loginAction } = await import("@/app/(auth)/actions");
    const where = await run(() => loginAction({ error: null }, form("boss@example.com")));

    expect(where).toContain("REDIRECT:/dashboard");
  });

  it("다른 사람이 로그인하면 ADMIN_EMAIL과 비교만 하고 넘어간다", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "student@example.com" } },
      error: null,
    });

    const { loginAction } = await import("@/app/(auth)/actions");
    await run(() => loginAction({ error: null }, form("student@example.com")));

    // 판정은 ensureAdminRole이 한다 — 라우트가 이메일을 미리 거르지 않는다
    expect(ensureAdminRole).toHaveBeenCalledWith(
      expect.anything(),
      "user-2",
      "student@example.com",
      "boss@example.com",
    );
  });
});
