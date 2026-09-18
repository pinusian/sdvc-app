import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-3] requireSiteUser — 기록 API가 매 요청 거치는 관문.
 *
 * gateSiteProject(없음/미배포/차단/로그인꺼짐)를 먼저 통과해야 하고,
 * 그다음 쿠키 → 서명 검증 → 실제 계정 조회(정지 여부까지)까지 전부
 * 맞아야 "이 사용자"로 인정한다. 하나라도 어긋나면 같은 401이다 —
 * "세션은 유효한데 계정이 없다"처럼 내부 사정을 노출하지 않는다.
 */

const getProjectBySlug = vi.fn();
const getSiteUserById = vi.fn();
const verifySiteSession = vi.fn();

vi.mock("@/lib/projects/store", () => ({
  getProjectBySlug: (...args: unknown[]) => getProjectBySlug(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  getSiteUserById: (...args: unknown[]) => getSiteUserById(...args),
}));

vi.mock("@/lib/site-accounts/session", () => ({
  verifySiteSession: (...args: unknown[]) => verifySiteSession(...args),
}));

import { requireSiteUser } from "@/lib/site-accounts/access";
import { SITE_SESSION_COOKIE } from "@/lib/site-accounts/cookie";

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
  email: "a@b.com",
  displayName: null,
  suspendedAt: null,
  suspendedReason: null,
};

function requestWithCookie(token: string | null) {
  const headers = new Headers();
  if (token !== null) headers.set("cookie", `${SITE_SESSION_COOKIE}=${token}`);
  return new Request("http://localhost:3000/api/site/reading-activity/records", { headers });
}

describe("[P11-3] requireSiteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectBySlug.mockResolvedValue(PROJECT);
    getSiteUserById.mockResolvedValue(SITE_USER);
    verifySiteSession.mockReturnValue({ siteUserId: "su-1", projectId: "proj-1" });
  });

  it("쿠키가 아예 없으면 401", async () => {
    const result = await requireSiteUser({} as never, "reading-activity", requestWithCookie(null));
    expect(result).toEqual({ ok: false, status: 401, error: "로그인이 필요합니다." });
  });

  it("서명이 무효한 토큰이면 401 (verifySiteSession이 null)", async () => {
    verifySiteSession.mockReturnValue(null);
    const result = await requireSiteUser({} as never, "reading-activity", requestWithCookie("garbage"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("다른 프로젝트용 토큰을 이 프로젝트에서 쓰면 401 (project_id 불일치)", async () => {
    verifySiteSession.mockReturnValue({ siteUserId: "su-1", projectId: "proj-OTHER" });
    const result = await requireSiteUser({} as never, "reading-activity", requestWithCookie("tok"));
    expect(result.ok).toBe(false);
  });

  it("토큰은 맞는데 그 계정이 이제 없으면(삭제 등) 401", async () => {
    getSiteUserById.mockResolvedValue(null);
    const result = await requireSiteUser({} as never, "reading-activity", requestWithCookie("tok"));
    expect(result.ok).toBe(false);
  });

  it("정지된 계정이면 세션이 유효해도 403 + 사유", async () => {
    getSiteUserById.mockResolvedValue({
      ...SITE_USER,
      suspendedAt: "2026-09-01T00:00:00Z",
      suspendedReason: "도배성 기록 작성",
    });

    const result = await requireSiteUser({} as never, "reading-activity", requestWithCookie("tok"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toContain("도배성 기록 작성");
    }
  });

  it("프로젝트 자체가 없거나 차단됐으면 쿠키 검사보다 먼저 404다", async () => {
    getProjectBySlug.mockResolvedValue(null);
    const result = await requireSiteUser({} as never, "no-such-slug", requestWithCookie("tok"));
    expect(result).toEqual({ ok: false, status: 404, error: "페이지를 찾을 수 없습니다." });
    expect(verifySiteSession).not.toHaveBeenCalled();
  });

  it("모두 맞으면 project와 siteUserId를 돌려준다", async () => {
    const result = await requireSiteUser({} as never, "reading-activity", requestWithCookie("tok"));
    expect(result).toEqual({ ok: true, project: PROJECT, siteUserId: "su-1" });
  });
});
