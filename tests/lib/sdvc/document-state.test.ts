import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceDocumentStage,
  approveDocumentVersion,
  hashDocumentContent,
  saveDocumentVersion,
  type DocumentVersion,
  type DocumentWorkflowDependencies,
} from "@/lib/sdvc/document-state";

const NOW = "2026-09-20T07:00:00.000Z";
const PLAN_V1: DocumentVersion = {
  id: "plan-v1",
  projectId: "project-1",
  kind: "plan",
  version: 1,
  content: "첫 계획",
  contentHash: "hash-plan-v1",
  createdAt: NOW,
};

function dependencies(): DocumentWorkflowDependencies {
  return {
    getLatestVersion: vi.fn().mockResolvedValue(null),
    insertVersion: vi.fn(async (input) => ({ id: `${input.kind}-v${input.version}`, ...input })),
    invalidateApprovals: vi.fn().mockResolvedValue(undefined),
    getApproval: vi.fn().mockResolvedValue(null),
    insertApproval: vi.fn(async (input) => ({ id: "approval-1", ...input })),
    getCurrentStage: vi.fn().mockResolvedValue("plan"),
    setCurrentStage: vi.fn().mockResolvedValue(undefined),
  };
}

describe("[T027] 문서 버전·해시 계약", () => {
  beforeEach(() => vi.clearAllMocks());

  it("같은 내용은 같은 SHA-256 해시를 만들고 공백 차이도 버전 내용으로 보존한다", () => {
    expect(hashDocumentContent("승인할 계획\n")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDocumentContent("승인할 계획\n")).toBe(hashDocumentContent("승인할 계획\n"));
    expect(hashDocumentContent("승인할 계획")).not.toBe(hashDocumentContent("승인할 계획\n"));
  });

  it("새 내용은 최신 버전 다음 번호의 불변 버전으로 저장한다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getLatestVersion).mockResolvedValue(PLAN_V1);

    const saved = await saveDocumentVersion(
      { projectId: "project-1", kind: "plan", content: "수정 계획", now: NOW },
      deps,
    );

    expect(saved).toMatchObject({ kind: "plan", version: 2, content: "수정 계획" });
    expect(saved.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(deps.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", kind: "plan", version: 2 }),
    );
  });

  it("승인된 계획이 바뀌면 계획·작업 승인을 무효화하고 현재 단계를 계획으로 되돌린다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getLatestVersion).mockResolvedValue(PLAN_V1);
    vi.mocked(deps.getCurrentStage).mockResolvedValue("implement");

    await saveDocumentVersion(
      { projectId: "project-1", kind: "plan", content: "영향이 있는 새 계획", now: NOW },
      deps,
    );

    expect(deps.invalidateApprovals).toHaveBeenCalledWith({
      projectId: "project-1",
      kinds: ["plan", "tasks"],
      invalidatedAt: NOW,
    });
    expect(deps.setCurrentStage).toHaveBeenCalledWith("project-1", "plan");
  });

  it("최신 버전과 내용이 같으면 중복 버전이나 승인 무효화를 만들지 않는다", async () => {
    const deps = dependencies();
    const content = "첫 계획";
    vi.mocked(deps.getLatestVersion).mockResolvedValue({
      ...PLAN_V1,
      content,
      contentHash: hashDocumentContent(content),
    });

    const saved = await saveDocumentVersion(
      { projectId: "project-1", kind: "plan", content, now: NOW },
      deps,
    );

    expect(saved.id).toBe(PLAN_V1.id);
    expect(deps.insertVersion).not.toHaveBeenCalled();
    expect(deps.invalidateApprovals).not.toHaveBeenCalled();
  });
});

describe("[T027] 승인·단계 전이 계약", () => {
  it("최신 계획 버전을 한 번 승인하면 승인자와 버전을 결부해 저장한다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getLatestVersion).mockResolvedValue(PLAN_V1);

    const approval = await approveDocumentVersion(
      {
        projectId: "project-1",
        kind: "plan",
        versionId: PLAN_V1.id,
        approvedBy: "learner-1",
        now: NOW,
      },
      deps,
    );

    expect(approval).toMatchObject({ versionId: PLAN_V1.id, approvedBy: "learner-1" });
    expect(deps.insertApproval).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", kind: "plan", versionId: PLAN_V1.id }),
    );
  });

  it("최신 버전과 다른 오래된 문서 승인은 거부한다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getLatestVersion).mockResolvedValue({ ...PLAN_V1, id: "plan-v2", version: 2 });

    await expect(
      approveDocumentVersion(
        {
          projectId: "project-1",
          kind: "plan",
          versionId: "plan-v1",
          approvedBy: "learner-1",
          now: NOW,
        },
        deps,
      ),
    ).rejects.toThrow(/최신|버전/);
    expect(deps.insertApproval).not.toHaveBeenCalled();
  });

  it("같은 문서 버전의 중복 승인은 새 기록을 만들지 않고 거부한다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getLatestVersion).mockResolvedValue(PLAN_V1);
    vi.mocked(deps.getApproval).mockResolvedValue({
      id: "approval-existing",
      projectId: "project-1",
      kind: "plan",
      versionId: PLAN_V1.id,
      approvedBy: "learner-1",
      approvedAt: NOW,
    });

    await expect(
      approveDocumentVersion(
        {
          projectId: "project-1",
          kind: "plan",
          versionId: PLAN_V1.id,
          approvedBy: "learner-1",
          now: NOW,
        },
        deps,
      ),
    ).rejects.toThrow(/이미|승인/);
    expect(deps.insertApproval).not.toHaveBeenCalled();
  });

  it("현재 계획 버전의 승인 없이는 작업 단계로 전이하지 않는다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getLatestVersion).mockResolvedValue(PLAN_V1);
    vi.mocked(deps.getApproval).mockResolvedValue(null);

    await expect(
      advanceDocumentStage({ projectId: "project-1", expectedStage: "plan" }, deps),
    ).rejects.toThrow(/승인/);
    expect(deps.setCurrentStage).not.toHaveBeenCalled();
  });

  it("현재 계획 버전이 승인됐으면 작업 단계로 전이한다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getLatestVersion).mockResolvedValue(PLAN_V1);
    vi.mocked(deps.getApproval).mockResolvedValue({
      id: "approval-1",
      projectId: "project-1",
      kind: "plan",
      versionId: PLAN_V1.id,
      approvedBy: "learner-1",
      approvedAt: NOW,
    });

    await expect(
      advanceDocumentStage({ projectId: "project-1", expectedStage: "plan" }, deps),
    ).resolves.toBe("tasks");
    expect(deps.setCurrentStage).toHaveBeenCalledWith("project-1", "tasks");
  });
});
