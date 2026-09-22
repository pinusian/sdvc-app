import { beforeEach, describe, expect, it, vi } from "vitest";

const requireLearnerAccess = vi.fn();
const getProjectById = vi.fn();
const createDocumentWorkflowStore = vi.fn();
const getDocumentWorkflowView = vi.fn();
const createPersistentRunStore = vi.fn();
const createPersistentRun = vi.fn();
const resumePersistentRun = vi.fn();
const cancelPersistentRun = vi.fn();

vi.mock("@/lib/auth/learner-route-guard", () => ({
  requireLearnerAccess: (...args: unknown[]) => requireLearnerAccess(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));
vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
}));
vi.mock("@/lib/sdvc/document-store", () => ({
  createDocumentWorkflowStore: (...args: unknown[]) => createDocumentWorkflowStore(...args),
}));
vi.mock("@/lib/sdvc/document-state", () => ({
  getDocumentWorkflowView: (...args: unknown[]) => getDocumentWorkflowView(...args),
}));
vi.mock("@/lib/execution/persistent-run-store", () => ({
  createPersistentRunStore: (...args: unknown[]) => createPersistentRunStore(...args),
}));
vi.mock("@/lib/execution/persistent-runs", () => ({
  createPersistentRun: (...args: unknown[]) => createPersistentRun(...args),
  resumePersistentRun: (...args: unknown[]) => resumePersistentRun(...args),
  cancelPersistentRun: (...args: unknown[]) => cancelPersistentRun(...args),
}));

const RUN = {
  id: "run-1",
  ownerId: "user-1",
  projectId: "project-1",
  documentBundleHash: "a".repeat(64),
  idempotencyKey: "browser-attempt-1",
  status: "queued",
  createdAt: "2026-09-22T01:00:00.000Z",
  updatedAt: "2026-09-22T01:00:00.000Z",
};

const APPROVED_VIEW = {
  currentStage: "implement",
  documents: [
    {
      kind: "plan",
      approvedVersionId: "plan-v2",
      versions: [{ id: "plan-v2", contentHash: "1".repeat(64) }],
    },
    {
      kind: "tasks",
      approvedVersionId: "tasks-v3",
      versions: [{ id: "tasks-v3", contentHash: "2".repeat(64) }],
    },
  ],
};

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context(runId = RUN.id) {
  return { params: Promise.resolve({ runId }) };
}

describe("[T035] 수강생 실행 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLearnerAccess.mockResolvedValue({ ok: true, user: { id: "user-1" } });
    getProjectById.mockResolvedValue({ id: "project-1", ownerId: "user-1" });
    createDocumentWorkflowStore.mockReturnValue({ __documents: true });
    createPersistentRunStore.mockReturnValue({ __runs: true });
    getDocumentWorkflowView.mockResolvedValue(APPROVED_VIEW);
    createPersistentRun.mockResolvedValue(RUN);
    resumePersistentRun.mockResolvedValue({
      run: { ...RUN, status: "running" },
      events: [{ id: "event-1", runId: RUN.id, sequence: 1, type: "red_started", payload: {}, createdAt: RUN.createdAt }],
    });
    cancelPersistentRun.mockResolvedValue({ ...RUN, status: "cancel_requested" });
  });

  it("소유 프로젝트의 승인된 Plan·Tasks로 서버가 묶음 해시를 계산해 실행을 만든다", async () => {
    const { POST } = await import("@/app/api/runs/route");
    const response = await POST(request("/api/runs", "POST", {
      projectId: "project-1",
      idempotencyKey: "browser-attempt-1",
    }));

    expect(response.status).toBe(201);
    expect(createPersistentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "user-1",
        projectId: "project-1",
        idempotencyKey: "browser-attempt-1",
        documentBundleHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      { __runs: true },
    );
  });

  it("Plan·Tasks 중 하나라도 승인되지 않았으면 실행을 만들지 않는다", async () => {
    getDocumentWorkflowView.mockResolvedValue({
      ...APPROVED_VIEW,
      documents: [APPROVED_VIEW.documents[0]],
    });
    const { POST } = await import("@/app/api/runs/route");
    const response = await POST(request("/api/runs", "POST", {
      projectId: "project-1",
      idempotencyKey: "browser-attempt-1",
    }));

    expect(response.status).toBe(409);
    expect(createPersistentRun).not.toHaveBeenCalled();
  });

  it("재접속 시 소유 실행과 누적 이벤트를 DB에서 복원한다", async () => {
    const { GET } = await import("@/app/api/runs/[runId]/route");
    const response = await GET(request(`/api/runs/${RUN.id}`), context());

    expect(response.status).toBe(200);
    expect(resumePersistentRun).toHaveBeenCalledWith(
      { runId: RUN.id, ownerId: "user-1" },
      { __runs: true },
    );
    expect(await response.json()).toMatchObject({ run: { status: "running" } });
  });

  it("취소 요청을 영속 상태로 남긴다", async () => {
    const { DELETE } = await import("@/app/api/runs/[runId]/route");
    const response = await DELETE(request(`/api/runs/${RUN.id}`, "DELETE"), context());

    expect(response.status).toBe(202);
    expect(cancelPersistentRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN.id, ownerId: "user-1" }),
      { __runs: true },
    );
  });

  it("실패·취소 실행은 같은 문서 묶음으로 새 멱등키를 써 재시도한다", async () => {
    resumePersistentRun.mockResolvedValue({ run: { ...RUN, status: "failed" }, events: [] });
    createPersistentRun.mockResolvedValue({ ...RUN, id: "run-2", idempotencyKey: "retry-2" });
    const { POST } = await import("@/app/api/runs/[runId]/retry/route");
    const response = await POST(
      request(`/api/runs/${RUN.id}/retry`, "POST", { idempotencyKey: "retry-2" }),
      context(),
    );

    expect(response.status).toBe(201);
    expect(createPersistentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: RUN.projectId,
        documentBundleHash: RUN.documentBundleHash,
        idempotencyKey: "retry-2",
      }),
      { __runs: true },
    );
  });
});
