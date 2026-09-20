import { createHash } from "node:crypto";

export const DOCUMENT_KINDS = [
  "constitution",
  "spec",
  "clarifications",
  "plan",
  "tasks",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const SDVC_STAGES = [
  "constitution",
  "specify",
  "clarify",
  "plan",
  "tasks",
  "analyze",
  "implement",
] as const;

export type SdvcStage = (typeof SDVC_STAGES)[number];

export interface DocumentVersion {
  id: string;
  projectId: string;
  kind: DocumentKind;
  version: number;
  content: string;
  contentHash: string;
  createdAt: string;
}

export interface DocumentApproval {
  id: string;
  projectId: string;
  kind: "plan" | "tasks";
  versionId: string;
  approvedBy: string;
  approvedAt: string;
}

export interface DocumentWorkflowDependencies {
  getLatestVersion(projectId: string, kind: DocumentKind): Promise<DocumentVersion | null>;
  insertVersion(input: Omit<DocumentVersion, "id">): Promise<DocumentVersion>;
  invalidateApprovals(input: {
    projectId: string;
    kinds: readonly ("plan" | "tasks")[];
    invalidatedAt: string;
  }): Promise<void>;
  getApproval(input: {
    projectId: string;
    kind: "plan" | "tasks";
    versionId: string;
  }): Promise<DocumentApproval | null>;
  insertApproval(input: Omit<DocumentApproval, "id">): Promise<DocumentApproval>;
  getCurrentStage(projectId: string): Promise<SdvcStage>;
  setCurrentStage(projectId: string, stage: SdvcStage): Promise<void>;
  listVersions(projectId: string): Promise<DocumentVersion[]>;
  listApprovals(projectId: string): Promise<DocumentApproval[]>;
}

export interface DocumentWorkflowView {
  currentStage: SdvcStage;
  documents: Array<{
    kind: DocumentKind;
    approvedVersionId: string | null;
    versions: DocumentVersion[];
  }>;
}

export async function getDocumentWorkflowView(
  projectId: string,
  dependencies: DocumentWorkflowDependencies,
): Promise<DocumentWorkflowView> {
  const [currentStage, versions, approvals] = await Promise.all([
    dependencies.getCurrentStage(projectId),
    dependencies.listVersions(projectId),
    dependencies.listApprovals(projectId),
  ]);

  return {
    currentStage,
    documents: DOCUMENT_KINDS.map((kind) => ({
      kind,
      approvedVersionId:
        approvals.find((approval) => approval.kind === kind)?.versionId ?? null,
      versions: versions
        .filter((version) => version.kind === kind)
        .sort((left, right) => right.version - left.version),
    })).filter((document) => document.versions.length > 0),
  };
}

export function isDocumentStageAtLeast(stage: SdvcStage, required: SdvcStage): boolean {
  return stageIndex(stage) >= stageIndex(required);
}

export function hashDocumentContent(_content: string): string {
  return createHash("sha256").update(_content, "utf8").digest("hex");
}

export async function saveDocumentVersion(
  input: {
    projectId: string;
    kind: DocumentKind;
    content: string;
    now: string;
  },
  dependencies: DocumentWorkflowDependencies,
): Promise<DocumentVersion> {
  if (!input.content.trim()) throw new Error("문서 내용이 비어 있습니다.");

  const latest = await dependencies.getLatestVersion(input.projectId, input.kind);
  const contentHash = hashDocumentContent(input.content);
  if (latest?.contentHash === contentHash) return latest;

  const saved = await dependencies.insertVersion({
    projectId: input.projectId,
    kind: input.kind,
    version: (latest?.version ?? 0) + 1,
    content: input.content,
    contentHash,
    createdAt: input.now,
  });

  if (latest) {
    const invalidatedKinds = approvalKindsInvalidatedBy(input.kind);
    if (invalidatedKinds.length > 0) {
      await dependencies.invalidateApprovals({
        projectId: input.projectId,
        kinds: invalidatedKinds,
        invalidatedAt: input.now,
      });
    }

    const currentStage = await dependencies.getCurrentStage(input.projectId);
    const rewindStage = stageForDocument(input.kind);
    if (stageIndex(currentStage) > stageIndex(rewindStage)) {
      await dependencies.setCurrentStage(input.projectId, rewindStage);
    }
  }

  return saved;
}

export async function approveDocumentVersion(
  input: {
    projectId: string;
    kind: "plan" | "tasks";
    versionId: string;
    approvedBy: string;
    now: string;
  },
  dependencies: DocumentWorkflowDependencies,
): Promise<DocumentApproval> {
  const latest = await dependencies.getLatestVersion(input.projectId, input.kind);
  if (!latest || latest.id !== input.versionId) {
    throw new Error("최신 문서 버전만 승인할 수 있습니다.");
  }

  const existing = await dependencies.getApproval({
    projectId: input.projectId,
    kind: input.kind,
    versionId: input.versionId,
  });
  if (existing) throw new Error("이미 승인한 문서 버전입니다.");

  return dependencies.insertApproval({
    projectId: input.projectId,
    kind: input.kind,
    versionId: input.versionId,
    approvedBy: input.approvedBy,
    approvedAt: input.now,
  });
}

export async function advanceDocumentStage(
  input: { projectId: string; expectedStage: SdvcStage },
  dependencies: DocumentWorkflowDependencies,
): Promise<SdvcStage> {
  const currentStage = await dependencies.getCurrentStage(input.projectId);
  if (currentStage !== input.expectedStage) {
    throw new Error("현재 SDVC 단계가 요청과 일치하지 않습니다.");
  }

  if (currentStage === "plan" || currentStage === "tasks") {
    const latest = await dependencies.getLatestVersion(input.projectId, currentStage);
    if (!latest) throw new Error("승인할 최신 문서 버전이 없습니다.");
    const approval = await dependencies.getApproval({
      projectId: input.projectId,
      kind: currentStage,
      versionId: latest.id,
    });
    if (!approval) throw new Error("현재 문서 버전의 승인이 필요합니다.");
  }

  const nextStage = SDVC_STAGES[stageIndex(currentStage) + 1] ?? currentStage;
  if (nextStage !== currentStage) {
    await dependencies.setCurrentStage(input.projectId, nextStage);
  }
  return nextStage;
}

function approvalKindsInvalidatedBy(
  kind: DocumentKind,
): readonly ("plan" | "tasks")[] {
  if (kind === "tasks") return ["tasks"];
  return ["plan", "tasks"];
}

function stageForDocument(kind: DocumentKind): SdvcStage {
  if (kind === "constitution") return "constitution";
  if (kind === "spec") return "specify";
  if (kind === "clarifications") return "clarify";
  return kind;
}

function stageIndex(stage: SdvcStage): number {
  return SDVC_STAGES.indexOf(stage);
}
