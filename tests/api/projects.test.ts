import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P4-3] DELETE /api/projects/[id] — 프로젝트 삭제(FR-022).
 * 만들기만 되고 못 지우면 안 되므로 저장과 같은 슬라이스에서 함께 만든다.
 */

const getUser = vi.fn();
const getProjectById = vi.fn();
const deleteProjectRow = vi.fn();
const deleteArtifactFiles = vi.fn();
const renameProject = vi.fn();
const deleteAllVersions = vi.fn();
const findConversationsByProjects = vi.fn();
const deleteConversationAttachments = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
  deleteProjectRow: (...args: unknown[]) => deleteProjectRow(...args),
  renameProject: (...args: unknown[]) => renameProject(...args),
}));

vi.mock("@/lib/artifacts/storage", () => ({
  deleteArtifactFiles: (...args: unknown[]) => deleteArtifactFiles(...args),
}));

vi.mock("@/lib/versions/store", () => ({
  deleteAllVersions: (...args: unknown[]) => deleteAllVersions(...args),
}));

vi.mock("@/lib/conversations/store", () => ({
  findConversationsByProjects: (...args: unknown[]) => findConversationsByProjects(...args),
}));

vi.mock("@/lib/attachments/store", () => ({
  deleteConversationAttachments: (...args: unknown[]) => deleteConversationAttachments(...args),
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
    deleteAllVersions.mockResolvedValue(undefined);
    findConversationsByProjects.mockResolvedValue({});
    deleteConversationAttachments.mockResolvedValue(0);
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

/**
 * [P7-1b] PATCH /api/projects/[id] — 이름 바꾸기 (FR-030, BL-002).
 *
 * 공개범위와 같은 소유권 검사를 그대로 쓴다 — 남의 프로젝트 이름을
 * 바꿀 수 있으면 목록이 남의 손에 흔들린다.
 */
describe("[P7-1b] PATCH /api/projects/[id] — 이름 변경", () => {
  const patch = (body: unknown) =>
    new Request("http://localhost:3000/api/projects/proj-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    renameProject.mockResolvedValue(undefined);
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const res = await PATCH(patch({ name: "새 이름" }), context);

    expect(res.status).toBe(401);
    expect(renameProject).not.toHaveBeenCalled();
  });

  it("내 프로젝트가 아니면 404", async () => {
    getProjectById.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const res = await PATCH(patch({ name: "남의 것" }), context);

    expect(res.status).toBe(404);
    expect(renameProject).not.toHaveBeenCalled();
  });

  it("이름을 바꾼다", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const res = await PATCH(patch({ name: "  소금빵 가게  " }), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "소금빵 가게" });
    expect(renameProject).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      "user-1",
      "소금빵 가게",
    );
  });

  it("빈 이름이나 너무 긴 이름은 400", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");

    for (const name of ["", "   ", "가".repeat(61), 123, null]) {
      const res = await PATCH(patch({ name }), context);
      expect(res.status, String(name)).toBe(400);
    }
    expect(renameProject).not.toHaveBeenCalled();
  });
});

/**
 * [P7-6c] 프로젝트를 지우면 되돌리기용 사본도 함께 지운다 (FR-012·FR-023).
 *
 * 본편만 지우고 사본이 남으면 "지웠다"는 말이 거짓이 된다 — 그 사본에는
 * 옛 홈페이지가 통째로 들어 있다.
 */
describe("[P7-6c] 삭제할 때 버전 사본도", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    deleteArtifactFiles.mockResolvedValue(3);
    deleteProjectRow.mockResolvedValue(true);
    deleteAllVersions.mockResolvedValue(9);
  });

  it("프로젝트를 지우면 사본도 지운다", async () => {
    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(200);
    expect(deleteAllVersions).toHaveBeenCalledWith(expect.anything(), "proj-1");
  });

  it("사본 삭제가 실패해도 본편 삭제는 끝낸다 (남은 것은 정리 작업이 다시 치운다)", async () => {
    deleteAllVersions.mockRejectedValue(new Error("저장소 오류"));

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(200);
    expect(deleteProjectRow).toHaveBeenCalled();
  });
});

/**
 * [BL-015] 첨부 파일이 영영 지워지지 않는다.
 *
 * `deleteConversationAttachments`는 [P7-8]부터 있었지만 아무도 부르지
 * 않았다 — 대화 삭제 기능 자체가 없어 부를 자리도 없었다. 그 대화로
 * 만든 프로젝트를 지울 때가 첨부까지 함께 정리할 자연스러운 자리다.
 */
describe("[BL-015] DELETE /api/projects/[id] — 첨부도 함께 정리", () => {
  it("이 프로젝트를 만든 대화의 첨부를 함께 지운다", async () => {
    findConversationsByProjects.mockResolvedValue({ "proj-1": "conv-1" });

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(200);
    expect(findConversationsByProjects).toHaveBeenCalledWith(
      expect.anything(),
      ["proj-1"],
      "user-1",
    );
    expect(deleteConversationAttachments).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "conv-1",
    );
  });

  it("이어가는 대화가 없으면(대화 없는 프로젝트) 조용히 넘어간다", async () => {
    findConversationsByProjects.mockResolvedValue({});

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(200);
    expect(deleteConversationAttachments).not.toHaveBeenCalled();
  });

  it("첨부 정리가 실패해도 프로젝트 삭제 자체는 끝낸다 — 사용자가 원한 건 삭제다", async () => {
    findConversationsByProjects.mockResolvedValue({ "proj-1": "conv-1" });
    deleteConversationAttachments.mockRejectedValue(new Error("storage down"));

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const res = await DELETE(request(), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, fileCount: 3 });
    expect(deleteProjectRow).toHaveBeenCalled();
  });
});
