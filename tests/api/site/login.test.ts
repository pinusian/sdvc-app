import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-2] POST /api/site/[slug]/auth/login — 사용자(방문자) 로그인.
 */

const getProjectBySlug = vi.fn();
const findSiteUserByEmail = vi.fn();
const verifyPassword = vi.fn();
const signSiteSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectBySlug: (...args: unknown[]) => getProjectBySlug(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  findSiteUserByEmail: (...args: unknown[]) => findSiteUserByEmail(...args),
}));

vi.mock("@/lib/site-accounts/crypto", () => ({
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
}));

vi.mock("@/lib/site-accounts/session", () => ({
  signSiteSession: (...args: unknown[]) => signSiteSession(...args),
}));

const PROJECT = {
  id: "proj-1",
  ownerId: "dev-1",
  name: "독서활동",
  slug: "reading-activity",
  visibility: "link",
  status: "deployed",
  blockedAt: null,
  siteLoginEnabled: true,
};

const SITE_USER = {
  id: "su-1",
  projectId: "proj-1",
  email: "student@example.com",
  displayName: null,
  suspendedAt: null,
  suspendedReason: null,
  passwordHash: "hashed-value",
};

const context = { params: Promise.resolve({ slug: "reading-activity" }) };

function request(body: unknown) {
  return new Request("http://localhost:3000/api/site/reading-activity/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P11-2] POST /api/site/[slug]/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectBySlug.mockResolvedValue(PROJECT);
    findSiteUserByEmail.mockResolvedValue(SITE_USER);
    verifyPassword.mockResolvedValue(true);
    signSiteSession.mockReturnValue("signed-token");
  });

  it("없는 계정이면 401 — 계정이 없는지 비밀번호가 틀렸는지 구분해서 알려주지 않는다", async () => {
    findSiteUserByEmail.mockResolvedValue(null);

    const { POST } = await import("@/app/api/site/[slug]/auth/login/route");
    const res = await POST(request({ email: "nobody@example.com", password: "hunter2!!" }), context);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("비밀번호가 틀리면 같은 401·같은 문구다", async () => {
    verifyPassword.mockResolvedValue(false);

    const { POST } = await import("@/app/api/site/[slug]/auth/login/route");
    const res = await POST(request({ email: "student@example.com", password: "wrong" }), context);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
  });

  it("정지된 계정은 사유와 함께 403이다 — 로그인 자체가 막힌다", async () => {
    findSiteUserByEmail.mockResolvedValue({
      ...SITE_USER,
      suspendedAt: "2026-09-01T00:00:00Z",
      suspendedReason: "도배성 기록 작성",
    });

    const { POST } = await import("@/app/api/site/[slug]/auth/login/route");
    const res = await POST(request({ email: "student@example.com", password: "hunter2!!" }), context);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toContain("도배성 기록 작성");
    expect(signSiteSession).not.toHaveBeenCalled();
  });

  it("개발자가 로그인 기능을 꺼두면 계정이 맞아도 막힌다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, siteLoginEnabled: false });

    const { POST } = await import("@/app/api/site/[slug]/auth/login/route");
    const res = await POST(request({ email: "student@example.com", password: "hunter2!!" }), context);

    expect(res.status).toBe(403);
    expect(findSiteUserByEmail).not.toHaveBeenCalled();
  });

  it("맞으면 세션 쿠키를 이 프로젝트 경로로만 내려준다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/login/route");
    const res = await POST(request({ email: "student@example.com", password: "hunter2!!" }), context);

    expect(res.status).toBe(200);
    expect(signSiteSession).toHaveBeenCalledWith({ siteUserId: "su-1", projectId: "proj-1" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("signed-token");
    // [BL-026] 쿠키를 실제로 읽는 곳은 /site/{slug}(페이지)가 아니라
    // /api/site/{slug}/...(기록·API 키·AI 요약)다 — 그쪽으로 한정해야
    // 브라우저가 실제로 이 쿠키를 실어 보낸다.
    expect(setCookie).toContain("Path=/api/site/reading-activity");
  });

  it("다른 프로젝트의 같은 이메일 계정과는 섞이지 않는다 — project_id로 찾는다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/login/route");
    await POST(request({ email: "student@example.com", password: "hunter2!!" }), context);

    expect(findSiteUserByEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "proj-1", email: "student@example.com" }),
    );
  });
});
