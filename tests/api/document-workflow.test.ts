import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getConversation = vi.fn();
const getProjectById = vi.fn();
const createDocumentWorkflowStore = vi.fn();
const getDocumentWorkflowView = vi.fn();
const approveDocumentVersion = vi.fn();
const advanceDocumentStage = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/conversations/store", () => ({
  getConversation: (...args: unknown[]) => getConversation(...args),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
}));

vi.mock("@/lib/sdvc/document-store", () => ({
  createDocumentWorkflowStore: (...args: unknown[]) => createDocumentWorkflowStore(...args),
}));

vi.mock("@/lib/sdvc/document-state", () => ({
  getDocumentWorkflowView: (...args: unknown[]) => getDocumentWorkflowView(...args),
  approveDocumentVersion: (...args: unknown[]) => approveDocumentVersion(...args),
  advanceDocumentStage: (...args: unknown[]) => advanceDocumentStage(...args),
}));

const VIEW = {
  currentStage: "plan",
  documents: [
    {
      kind: "plan",
      approvedVersionId: null,
      versions: [
        {
          id: "plan-v2",
          projectId: "project-1",
          kind: "plan",
          version: 2,
          content: "두 번째 계획",
          contentHash: "hash-v2",
          createdAt: "2026-09-20T09:00:00.000Z",
        },
        {
          id: "plan-v1",
          projectId: "project-1",
          kind: "plan",
          version: 1,
          content: "첫 계획",
          contentHash: "hash-v1",
          createdAt: "2026-09-20T08:00:00.000Z",
        },
      ],
    },
  ],
};

function context(id = "conv-1") {
  return { params: Promise.resolve({ id }) };
}

describe("[T030] 대화 문서 조회·승인 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getConversation.mockResolvedValue({
      id: "conv-1",
      ownerId: "user-1",
      currentBlock: "plan",
      title: "시험 프로젝트",
      projectId: "project-1",
    });
    getProjectById.mockResolvedValue({ id: "project-1", ownerId: "user-1" });
    createDocumentWorkflowStore.mockReturnValue({ __store: true });
    getDocumentWorkflowView.mockResolvedValue(VIEW);
    approveDocumentVersion.mockResolvedValue({ id: "approval-1" });
    advanceDocumentStage.mockResolvedValue("tasks");
  });

  it("내 대화에 저장된 문서의 모든 버전과 승인 상태를 돌려준다", async () => {
    const { GET } = await import("@/app/api/conversations/[id]/documents/route");
    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VIEW);
    expect(getDocumentWorkflowView).toHaveBeenCalledWith("project-1", { __store: true });
  });

  it("최신 계획 버전을 승인하고 문서 단계를 tasks로 전진시킨다", async () => {
    const { POST } = await import("@/app/api/conversations/[id]/documents/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "plan", versionId: "plan-v2" }),
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(approveDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        kind: "plan",
        versionId: "plan-v2",
        approvedBy: "user-1",
      }),
      { __store: true },
    );
    expect(advanceDocumentStage).toHaveBeenCalledWith(
      { projectId: "project-1", expectedStage: "plan" },
      { __store: true },
    );
    expect(await response.json()).toMatchObject({ currentStage: "tasks" });
  });

  it("대화 단계와 다른 문서 승인은 거부한다", async () => {
    const { POST } = await import("@/app/api/conversations/[id]/documents/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "tasks", versionId: "tasks-v1" }),
      }),
      context(),
    );

    expect(response.status).toBe(409);
    expect(approveDocumentVersion).not.toHaveBeenCalled();
  });

  it("프로젝트가 연결되지 않았거나 남의 프로젝트면 문서를 노출하지 않는다", async () => {
    getProjectById.mockResolvedValue(null);
    const { GET } = await import("@/app/api/conversations/[id]/documents/route");
    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(404);
    expect(getDocumentWorkflowView).not.toHaveBeenCalled();
  });
});
