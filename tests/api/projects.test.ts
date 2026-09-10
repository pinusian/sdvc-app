import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P4-3] DELETE /api/projects/[id] — 프로젝트 삭제(FR-022).
 * 만들기만 되고 못 지우면 안 되므로 저장과 같은 슬라이스에서 함께 만든다.
 */

const getUser = vi.fn();
const getProjectById = vi.fn();
const deleteProjectRow = vi.fn();
const deleteArtifactFiles = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
  deleteProjectRow: (...args: unknown[]) => deleteProjectRow(...args),
}));

vi.mock("@/lib/artifacts/storage", () => ({
  deleteArtifactFiles: (...args: unknown[]) => deleteArtifactFiles(...args),
}));

const context = { params: Promise.resolve({ id: "proj-1" }) };
const request = () =>
  new Request("http://localhost:3000/api/projects/proj-1", { method: "DELETE" });

const PROJECT = {
  id: "proj-1",
  ownerId: "user-1",
  name: "내 홈페이지",
  slug: "my-homepage",
  visibility: "private",
  status: "deployed",
};

describe("[P4-3] DELETE /api/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    deleteArtifactFiles.mockResolvedValue(3);
    deleteProjectRow.mockResolvedValue(true);
  });

  it("로그인하지 않으면 401이고 아무것도 지우지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(401);
    expect(deleteArtifactFiles).not.toHaveBeenCalled();
    expect(deleteProjectRow).not.toHaveBeenCalled();
  });

  it("내 프로젝트가 아니면 404이고 아무것도 지우지 않는다", async () => {
    getProjectById.mockResolvedValue(null);

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(404);
    expect(deleteArtifactFiles).not.toHaveBeenCalled();
    expect(deleteProjectRow).not.toHaveBeenCalled();
  });

  it("파일을 먼저 지우고 그 다음 기록을 지운다", async () => {
    const order: string[] = [];
    deleteArtifactFiles.mockImplementation(async () => {
      order.push("files");
      return 3;
    });
    deleteProjectRow.mockImplementation(async () => {
      order.push("row");
      return true;
    });

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, fileCount: 3 });
    // 기록을 먼저 지우면 파일 주인을 잃어 영영 못 지운다.
    expect(order).toEqual(["files", "row"]);
  });

  it("파일 삭제가 실패하면 기록도 남긴 채 500을 준다", async () => {
    deleteArtifactFiles.mockRejectedValue(new Error("storage down"));

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(500);
    expect(deleteProjectRow).not.toHaveBeenCalled();
  });
});
