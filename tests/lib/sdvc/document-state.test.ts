import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveDocumentAndAdvance,
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
    approveAndAdvance: vi.fn(async (input) => ({
      approval: { id: "approval-1", ...input, approvedAt: input.now },
      currentStage: (input.kind === "plan" ? "tasks" : "analyze") as "tasks" | "analyze",
      created: true,
    })),
    getCurrentStage: vi.fn().mockResolvedValue("plan"),
    setCurrentStage: vi.fn().mockResolvedValue(undefined),
    listVersions: vi.fn().mockResolvedValue([]),
    listApprovals: vi.fn().mockResolvedValue([]),
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

describe("[T031] 승인·단계 전이 계약", () => {
  it("승인과 단계 전이를 저장소의 단일 원자 작업에 위임한다", async () => {
    const deps = dependencies();
    const input = {
      projectId: "project-1",
      kind: "plan" as const,
      versionId: PLAN_V1.id,
      approvedBy: "learner-1",
      now: NOW,
    };

    await expect(approveDocumentAndAdvance(input, deps)).resolves.toMatchObject({
      currentStage: "tasks",
      created: true,
    });
    expect(deps.approveAndAdvance).toHaveBeenCalledWith(input);
  });
});
