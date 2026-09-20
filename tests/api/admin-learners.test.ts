import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const auditAndWarn = vi.fn();
const listLearnerOverviews = vi.fn();

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  auditAndWarn: (...args: unknown[]) => auditAndWarn(...args),
}));

vi.mock("@/lib/admin/learners", () => ({
  listLearnerOverviews: (...args: unknown[]) => listLearnerOverviews(...args),
}));

const ADMIN = { marker: "admin-client" };
const LEARNER = {
  id: "learner-1",
  email: "one@example.com",
  joinedAt: "2026-09-01T00:00:00.000Z",
};

describe("[T019] /api/admin/learners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({
      ok: true,
      ctx: { admin: ADMIN, actorId: "admin-1", actor: { role: "admin" } },
    });
    auditAndWarn.mockResolvedValue({});
    listLearnerOverviews.mockResolvedValue([LEARNER]);
  });

  it("일반 수강생에게는 목록 존재를 숨기고 원천 조회를 하지 않는다", async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "찾을 수 없습니다." }, { status: 404 }),
    });

    const { GET } = await import("@/app/api/admin/learners/route");
    const response = await GET(new Request("http://localhost/api/admin/learners"));

    expect(response.status).toBe(404);
    expect(requireAdmin).toHaveBeenCalledWith("developer:read");
    expect(listLearnerOverviews).not.toHaveBeenCalled();
  });

  it("검색어를 집계 조회에 전달하고 열람을 감사 기록한다", async () => {
    const { GET } = await import("@/app/api/admin/learners/route");
    const response = await GET(
      new Request("http://localhost/api/admin/learners?search=one%40example.com"),
    );

    expect(response.status).toBe(200);
    expect(listLearnerOverviews).toHaveBeenCalledWith(ADMIN, {
      search: "one@example.com",
      learnerId: undefined,
    });
    expect(auditAndWarn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "developer:read",
        detail: { count: 1, search: "one@example.com", view: "list" },
      }),
    );
    expect(await response.json()).toEqual({ learners: [LEARNER] });
  });

  it("id가 있으면 한 수강생 상세를 반환하고 대상을 감사 기록한다", async () => {
    const { GET } = await import("@/app/api/admin/learners/route");
    const response = await GET(
      new Request("http://localhost/api/admin/learners?id=learner-1"),
    );

    expect(response.status).toBe(200);
    expect(listLearnerOverviews).toHaveBeenCalledWith(ADMIN, {
      search: undefined,
      learnerId: "learner-1",
    });
    expect(auditAndWarn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetType: "profile", targetId: "learner-1" }),
    );
    expect(await response.json()).toEqual({ learner: LEARNER });
  });

  it("없는 상세 id는 404를 반환한다", async () => {
    listLearnerOverviews.mockResolvedValue([]);

    const { GET } = await import("@/app/api/admin/learners/route");
    const response = await GET(
      new Request("http://localhost/api/admin/learners?id=missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "수강생을 찾을 수 없습니다." });
  });
});
