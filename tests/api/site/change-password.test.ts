import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [BL-032] POST /api/site/[slug]/auth/change-password — 방문자 본인이
 * 로그인한 뒤 스스로 비밀번호를 바꾼다.
 *
 * [BL-031]에서 개발자가 대신 재설정한 임시 비밀번호가 사실상 영구
 * 비밀번호가 되는 문제를 이걸로 닫는다. 현재 비밀번호를 먼저 확인한다 —
 * 세션이 살아있다고 해서 비밀번호까지 아무나 바꿀 수 있게 하면 안 된다
 * (세션 탈취 시 피해를 줄인다).
 */

const requireSiteUser = vi.fn();
const getSiteUserPasswordHash = vi.fn();
const setSiteUserPasswordHash = vi.fn();
const verifyPassword = vi.fn();
const hashPassword = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/site-accounts/access", () => ({
  requireSiteUser: (...args: unknown[]) => requireSiteUser(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  getSiteUserPasswordHash: (...args: unknown[]) => getSiteUserPasswordHash(...args),
  setSiteUserPasswordHash: (...args: unknown[]) => setSiteUserPasswordHash(...args),
}));

vi.mock("@/lib/site-accounts/crypto", () => ({
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
  hashPassword: (...args: unknown[]) => hashPassword(...args),
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
  return new Request("http://localhost:3000/api/site/reading-activity/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[BL-032] POST /api/site/[slug]/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSiteUser.mockResolvedValue({ ok: true, project: PROJECT, siteUserId: "su-1" });
    getSiteUserPasswordHash.mockResolvedValue("salt:currenthash");
    verifyPassword.mockResolvedValue(true);
    hashPassword.mockResolvedValue("salt:newhash");
    setSiteUserPasswordHash.mockResolvedValue(undefined);
  });

  it("로그인 안 했으면 관문 상태 그대로, 아무것도 바꾸지 않는다", async () => {
    requireSiteUser.mockResolvedValue({ ok: false, status: 401, error: "로그인이 필요합니다." });

    const { POST } = await import("@/app/api/site/[slug]/auth/change-password/route");
    const res = await POST(
      request({ currentPassword: "old-password-1", newPassword: "new-password-1" }),
      context,
    );

    expect(res.status).toBe(401);
    expect(setSiteUserPasswordHash).not.toHaveBeenCalled();
  });

  it("현재 비밀번호가 틀리면 401이고 바꾸지 않는다", async () => {
    verifyPassword.mockResolvedValue(false);

    const { POST } = await import("@/app/api/site/[slug]/auth/change-password/route");
    const res = await POST(
      request({ currentPassword: "wrong-password", newPassword: "new-password-1" }),
      context,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("현재 비밀번호");
    expect(setSiteUserPasswordHash).not.toHaveBeenCalled();
  });

  it("새 비밀번호가 8자 미만이면 400이고 바꾸지 않는다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/change-password/route");
    const res = await POST(
      request({ currentPassword: "old-password-1", newPassword: "short" }),
      context,
    );

    expect(res.status).toBe(400);
    expect(setSiteUserPasswordHash).not.toHaveBeenCalled();
  });

  it("정상 요청이면 새 비밀번호를 해시해서 저장한다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/change-password/route");
    const res = await POST(
      request({ currentPassword: "old-password-1", newPassword: "new-password-1" }),
      context,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(verifyPassword).toHaveBeenCalledWith("old-password-1", "salt:currenthash");
    expect(hashPassword).toHaveBeenCalledWith("new-password-1");
    expect(setSiteUserPasswordHash).toHaveBeenCalledWith(expect.anything(), {
      siteUserId: "su-1",
      passwordHash: "salt:newhash",
    });
  });
});
