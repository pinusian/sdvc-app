import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P7-6b] /api/projects/[id]/rollback — 되돌리기 (FR-012).
 *
 * 남의 프로젝트를 되돌릴 수 있으면 남의 홈페이지를 과거로 돌려버릴 수 있다.
 * 공개범위·이름 변경과 같은 소유권 검사를 쓴다.
 */

const getUser = vi.fn();
const getProjectById = vi.fn();
const listVersions = vi.fn();
const restoreVersion = vi.fn();
const saveVersion = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
}));

vi.mock("@/lib/versions/store", () => ({
  listVersions: (...args: unknown[]) => listVersions(...args),
  restoreVersion: (...args: unknown[]) => restoreVersion(...args),
  saveVersion: (...args: unknown[]) => saveVersion(...args),
}));

const context = { params: Promise.resolve({ id: "proj-1" }) };
const PROJECT = { id: "proj-1", ownerId: "user-1", name: "내 홈페이지", slug: "s", status: "deployed" };

const get = () => new Request("http://localhost:3000/api/projects/proj-1/rollback");
const post = (body: unknown) =>
  new Request("http://localhost:3000/api/projects/proj-1/rollback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("[P7-6b] 되돌리기 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    listVersions.mockResolvedValue([
      { name: "0002", meta: { at: "2026-09-12T11:00:00.000Z", request: "제목 크게" } },
      { name: "0001", meta: { at: "2026-09-12T10:00:00.000Z", request: "빵집 만들어줘" } },
    ]);
    restoreVersion.mockResolvedValue({ fileCount: 2, removedCount: 1 });
    saveVersion.mockResolvedValue("0003");
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { GET, POST } = await import("@/app/api/projects/[id]/rollback/route");
    expect((await GET(get(), context)).status).toBe(401);
    expect((await POST(post({ version: "0001" }), context)).status).toBe(401);
    expect(restoreVersion).not.toHaveBeenCalled();
  });

  it("남의 프로젝트는 404", async () => {
    getProjectById.mockResolvedValue(null);

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "0001" }), context);

    expect(res.status).toBe(404);
    expect(restoreVersion).not.toHaveBeenCalled();
  });

  it("버전 목록을 최신부터 돌려준다", async () => {
    const { GET } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await GET(get(), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions.map((v: { name: string }) => v.name)).toEqual(["0002", "0001"]);
    expect(body.versions[0].request).toBe("제목 크게");
  });

  it("되돌리기 전에 지금 상태를 먼저 사본으로 남긴다", async () => {
    const order: string[] = [];
    saveVersion.mockImplementation(async () => {
      order.push("save");
      return "0003";
    });
    restoreVersion.mockImplementation(async () => {
      order.push("restore");
      return { fileCount: 2, removedCount: 0 };
    });

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    await POST(post({ version: "0001" }), context);

    // 지금 상태를 남겨두지 않으면 "되돌리기를 취소"할 수가 없다
    expect(order).toEqual(["save", "restore"]);
  });

  it("되돌리면 몇 개가 바뀌었는지 알려준다", async () => {
    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "0001" }), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "0001", fileCount: 2, removedCount: 1 });
  });

  it("버전 이름이 이상하면 400 (경로를 벗어나지 못하게)", async () => {
    const { POST } = await import("@/app/api/projects/[id]/rollback/route");

    for (const version of ["../다른프로젝트", "0001/..", "", null, 1]) {
      const res = await POST(post({ version }), context);
      expect(res.status, String(version)).toBe(400);
    }
    expect(restoreVersion).not.toHaveBeenCalled();
  });

  it("없는 버전이면 404로 알린다", async () => {
    restoreVersion.mockRejectedValue(new Error("그 버전을 찾을 수 없습니다."));

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "9999" }), context);

    expect(res.status).toBe(404);
  });
});
