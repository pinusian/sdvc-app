import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P5-3] PATCH /api/projects/[id]/visibility — 공개범위 변경 (FR-007).
 * 이걸 바꿔야 만든 홈페이지를 남에게 보여줄 수 있다.
 */

const getUser = vi.fn();
const getProjectById = vi.fn();
const setProjectVisibility = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
  setProjectVisibility: (...args: unknown[]) => setProjectVisibility(...args),
}));

const PROJECT = {
  id: "proj-1",
  ownerId: "user-1",
  name: "내 홈페이지",
  slug: "my-homepage",
  visibility: "private",
  status: "deployed",
};

const context = { params: Promise.resolve({ id: "proj-1" }) };

function request(body: unknown) {
  return new Request("http://localhost:3000/api/projects/proj-1/visibility", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P5-3] PATCH /api/projects/[id]/visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    setProjectVisibility.mockResolvedValue(undefined);
  });

  it("로그인하지 않으면 401이고 아무것도 바꾸지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { PATCH } = await import("@/app/api/projects/[id]/visibility/route");
    const res = await PATCH(request({ visibility: "link" }), context);

    expect(res.status).toBe(401);
    expect(setProjectVisibility).not.toHaveBeenCalled();
  });

  it("내 프로젝트가 아니면 404이고 아무것도 바꾸지 않는다", async () => {
    getProjectById.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/projects/[id]/visibility/route");
    const res = await PATCH(request({ visibility: "link" }), context);

    expect(res.status).toBe(404);
    expect(setProjectVisibility).not.toHaveBeenCalled();
  });

  it("세 가지 공개범위만 허용한다", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/visibility/route");

    for (const visibility of ["private", "link", "public"]) {
      const res = await PATCH(request({ visibility }), context);
      expect(res.status, visibility).toBe(200);
      expect(await res.json()).toEqual({ visibility });
    }

    for (const bad of ["everyone", "", null, 42, undefined]) {
      const res = await PATCH(request({ visibility: bad }), context);
      expect(res.status, String(bad)).toBe(400);
    }
    expect(setProjectVisibility).toHaveBeenCalledTimes(3);
  });

  it("바꿀 때 소유자 조건을 함께 넘긴다", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/visibility/route");
    await PATCH(request({ visibility: "public" }), context);

    expect(setProjectVisibility).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      "user-1",
      "public",
    );
  });
});
