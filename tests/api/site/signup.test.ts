import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-2] POST /api/site/[slug]/auth/signup — 사용자(방문자) 가입.
 *
 * 개발자 가입([P2-5])과 다른 점: 로그인이 Supabase Auth가 아니라
 * `site_users` 표 직접 관리([P11-1])이고, 프로젝트(project_id)로 격리된다.
 */

const getProjectBySlug = vi.fn();
const findSiteUserByEmail = vi.fn();
const createSiteUser = vi.fn();
const hashPassword = vi.fn();
const signSiteSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectBySlug: (...args: unknown[]) => getProjectBySlug(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  findSiteUserByEmail: (...args: unknown[]) => findSiteUserByEmail(...args),
  createSiteUser: (...args: unknown[]) => createSiteUser(...args),
}));

vi.mock("@/lib/site-accounts/crypto", () => ({
  hashPassword: (...args: unknown[]) => hashPassword(...args),
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

const context = { params: Promise.resolve({ slug: "reading-activity" }) };

function request(body: unknown) {
  return new Request("http://localhost:3000/api/site/reading-activity/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P11-2] POST /api/site/[slug]/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectBySlug.mockResolvedValue(PROJECT);
    findSiteUserByEmail.mockResolvedValue(null);
    hashPassword.mockResolvedValue("hashed-value");
    createSiteUser.mockResolvedValue({
      id: "su-1",
      projectId: "proj-1",
      email: "student@example.com",
      displayName: null,
      suspendedAt: null,
      suspendedReason: null,
    });
    signSiteSession.mockReturnValue("signed-token");
  });

  it("없는 주소면 404 — 있는지 없는지도 알려주지 않는다", async () => {
    getProjectBySlug.mockResolvedValue(null);

    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(request({ email: "a@b.com", password: "hunter2!!" }), context);

    expect(res.status).toBe(404);
    expect(createSiteUser).not.toHaveBeenCalled();
  });

  it("아직 배포되지 않은 프로젝트는 404다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, status: "draft" });

    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(request({ email: "a@b.com", password: "hunter2!!" }), context);

    expect(res.status).toBe(404);
  });

  it("차단된 프로젝트는 404다 (FR-016과 같은 원칙 — 존재를 숨긴다)", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, blockedAt: "2026-01-01T00:00:00Z" });

    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(request({ email: "a@b.com", password: "hunter2!!" }), context);

    expect(res.status).toBe(404);
  });

  it("개발자가 로그인 기능을 꺼두면 막는다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, siteLoginEnabled: false });

    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(request({ email: "a@b.com", password: "hunter2!!" }), context);

    expect(res.status).toBe(403);
    expect(createSiteUser).not.toHaveBeenCalled();
  });

  it("이메일 형식이 아니면 400이고 비밀번호를 해시하지 않는다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(request({ email: "not-an-email", password: "hunter2!!" }), context);

    expect(res.status).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("비밀번호가 8자 미만이면 400이다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(request({ email: "a@b.com", password: "short" }), context);

    expect(res.status).toBe(400);
  });

  it("같은 프로젝트에 이미 있는 이메일이면 409다", async () => {
    findSiteUserByEmail.mockResolvedValue({
      id: "su-existing",
      projectId: "proj-1",
      email: "a@b.com",
      passwordHash: "x",
    });

    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(request({ email: "a@b.com", password: "hunter2!!" }), context);

    expect(res.status).toBe(409);
    expect(createSiteUser).not.toHaveBeenCalled();
  });

  it("성공하면 비밀번호를 해시해서 저장하고, 세션 쿠키를 내려준다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(
      request({ email: "student@example.com", password: "hunter2!!" }),
      context,
    );

    expect(res.status).toBe(200);
    expect(hashPassword).toHaveBeenCalledWith("hunter2!!");
    expect(createSiteUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        email: "student@example.com",
        passwordHash: "hashed-value",
      }),
    );
    expect(signSiteSession).toHaveBeenCalledWith({ siteUserId: "su-1", projectId: "proj-1" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("signed-token");
    expect(setCookie).toContain("HttpOnly");
    // 이 프로젝트의 경로에만 쿠키가 걸려야 다른 산출물 세션과 안 섞인다.
    // [BL-026] /site/{slug}(페이지)가 아니라 /api/site/{slug}/...(이
    // 쿠키를 실제로 읽는 기록·API 키·AI 요약 라우트)로 한정해야 브라우저가
    // 실제로 이 쿠키를 실어 보낸다.
    expect(setCookie).toContain("Path=/api/site/reading-activity");

    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeUndefined();
  });

  it("응답 어디에도 비밀번호 원문·해시가 노출되지 않는다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/signup/route");
    const res = await POST(
      request({ email: "student@example.com", password: "hunter2!!" }),
      context,
    );

    const text = JSON.stringify(await res.clone().json());
    expect(text).not.toContain("hunter2!!");
    expect(text).not.toContain("hashed-value");
  });
});
