import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-7] PATCH /api/projects/[id]/site-login — 방문자 로그인 켜기/끄기.
 *
 * [P5-3] 공개범위 변경과 완전히 같은 모양 — 소유자만 바꿀 수 있고,
 * 존재하지 않거나 남의 프로젝트면 404로 존재 자체를 숨긴다.
 */

const getUser = vi.fn();
const getProjectById = vi.fn();
const setProjectSiteLoginEnabled = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
  setProjectSiteLoginEnabled: (...args: unknown[]) => setProjectSiteLoginEnabled(...args),
}));

const PROJECT = {
  id: "proj-1",
  ownerId: "user-1",
  name: "독서활동",
  slug: "reading",
  visibility: "link",
  status: "deployed",
  siteLoginEnabled: true,
};

const context = { params: Promise.resolve({ id: "proj-1" }) };

function request(body: unknown) {
  return new Request("http://localhost:3000/api/projects/proj-1/site-login", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P11-7] PATCH /api/projects/[id]/site-login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    setProjectSiteLoginEnabled.mockResolvedValue(undefined);
  });

  it("로그인하지 않으면 401이고 아무것도 바꾸지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { PATCH } = await import("@/app/api/projects/[id]/site-login/route");
    const res = await PATCH(request({ enabled: false }), context);

    expect(res.status).toBe(401);
    expect(setProjectSiteLoginEnabled).not.toHaveBeenCalled();
  });

  it("내 프로젝트가 아니면 404이고 아무것도 바꾸지 않는다", async () => {
    getProjectById.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/projects/[id]/site-login/route");
    const res = await PATCH(request({ enabled: false }), context);

    expect(res.status).toBe(404);
    expect(setProjectSiteLoginEnabled).not.toHaveBeenCalled();
  });

  it("불리언이 아니면 400", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/site-login/route");

    for (const bad of ["true", 1, null, undefined]) {
      const res = await PATCH(request({ enabled: bad }), context);
      expect(res.status, String(bad)).toBe(400);
    }
    expect(setProjectSiteLoginEnabled).not.toHaveBeenCalled();
  });

  it("켜고 끌 수 있고, 바뀐 값을 소유자 조건과 함께 넘긴다", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/site-login/route");

    const off = await PATCH(request({ enabled: false }), context);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ enabled: false });
    expect(setProjectSiteLoginEnabled).toHaveBeenCalledWith(expect.anything(), "proj-1", "user-1", false);

    const on = await PATCH(request({ enabled: true }), context);
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ enabled: true });
  });
});
