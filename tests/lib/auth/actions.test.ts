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
const ensureProfile = vi.fn();
const requestPasswordReset = vi.fn();

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

vi.mock("@/lib/auth/profile", () => ({
  ensureProfile: (...a: unknown[]) => ensureProfile(...a),
}));

vi.mock("@/lib/auth/reset", () => ({
  requestPasswordReset: (...a: unknown[]) => requestPasswordReset(...a),
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
    ensureProfile.mockResolvedValue({ created: false });
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

/**
 * [BL-016] 프로필 자가 복구가 로그인에 배선되어 있는가.
 *
 * **순서가 핵심이다.** `ensureAdminRole`은 `update`라서 프로필이 없으면
 * 0행을 고치고 조용히 지나간다 — 프로필을 먼저 만들지 않으면 관리자
 * 승격도 함께 실패한다.
 */
describe("[BL-016] loginAction — 프로필 자가 복구", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAIL = "boss@example.com";
    loginDeveloper.mockResolvedValue({ success: true });
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "student@example.com" } },
      error: null,
    });
    ensureAdminRole.mockResolvedValue({ promoted: false });
    ensureProfile.mockResolvedValue({ created: false });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("로그인할 때마다 프로필이 있는지 확인한다", async () => {
    const { loginAction } = await import("@/app/(auth)/actions");
    await run(() => loginAction({ error: null }, form("student@example.com")));

    expect(ensureProfile).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "student@example.com",
    );
  });

  it("**프로필을 먼저** 만들고 그다음 승격한다 — update는 없는 행을 못 고친다", async () => {
    const order: string[] = [];
    ensureProfile.mockImplementation(async () => {
      order.push("profile");
      return { created: true };
    });
    ensureAdminRole.mockImplementation(async () => {
      order.push("admin");
      return { promoted: true };
    });

    const { loginAction } = await import("@/app/(auth)/actions");
    await run(() => loginAction({ error: null }, form("boss@example.com")));

    expect(order).toEqual(["profile", "admin"]);
  });

  it("복구가 실패해도 로그인은 막지 않는다", async () => {
    ensureProfile.mockRejectedValue(new Error("DB 오류"));

    const { loginAction } = await import("@/app/(auth)/actions");
    const where = await run(() => loginAction({ error: null }, form("student@example.com")));

    expect(where).toContain("REDIRECT:/dashboard");
  });

  it("로그인에 실패하면 확인하지 않는다", async () => {
    loginDeveloper.mockResolvedValue({ success: false, error: "비밀번호가 틀렸습니다." });

    const { loginAction } = await import("@/app/(auth)/actions");
    await loginAction({ error: null }, form("student@example.com"));

    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("관리자 화면 로그인(adminLoginAction)에서도 똑같이 복구한다", async () => {
    const { adminLoginAction } = await import("@/app/(auth)/actions");
    await run(() => adminLoginAction({ error: null }, form("student@example.com")));

    expect(ensureProfile).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "student@example.com",
    );
  });
});

/**
 * [BL-030] requestPasswordResetAction — 개발자·시스템관리자 비밀번호 찾기.
 * 이 두 계정은 하나의 Supabase Auth 계정을 공유하므로 액션도 하나다.
 */
describe("[BL-030] requestPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestPasswordReset.mockResolvedValue({ success: true });
  });

  function emailForm(email: string) {
    const data = new FormData();
    data.append("email", email);
    return data;
  }

  it("요청을 받으면 이 서비스 origin의 /update-password로 리다이렉트할 주소를 넘긴다", async () => {
    const { requestPasswordResetAction } = await import("@/app/(auth)/actions");
    await run(() => requestPasswordResetAction({ error: null }, emailForm("dev@example.com")));

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.anything(),
      "dev@example.com",
      "https://sdvc-app.vercel.app/update-password",
    );
  });

  it("성공하면 확인 화면으로 리다이렉트한다", async () => {
    const { requestPasswordResetAction } = await import("@/app/(auth)/actions");
    const where = await run(() =>
      requestPasswordResetAction({ error: null }, emailForm("dev@example.com")),
    );

    expect(where).toContain("REDIRECT:/forgot-password?sent=1");
  });

  it("이메일 형식이 아니면 리다이렉트하지 않고 오류를 그대로 보여준다", async () => {
    requestPasswordReset.mockResolvedValue({ success: false, error: "올바른 이메일 주소를 입력해주세요." });

    const { requestPasswordResetAction } = await import("@/app/(auth)/actions");
    const result = await requestPasswordResetAction({ error: null }, emailForm("not-an-email"));

    expect(result).toEqual({ error: "올바른 이메일 주소를 입력해주세요." });
  });
});
