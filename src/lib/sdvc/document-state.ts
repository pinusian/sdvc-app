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

export interface DocumentApprovalTransition {
  approval: DocumentApproval;
  currentStage: SdvcStage;
  created: boolean;
}

export interface DocumentWorkflowDependencies {
  getLatestVersion(projectId: string, kind: DocumentKind): Promise<DocumentVersion | null>;
  insertVersion(input: Omit<DocumentVersion, "id">): Promise<DocumentVersion>;
  invalidateApprovals(input: {
    projectId: string;
    kinds: readonly ("plan" | "tasks")[];
    invalidatedAt: string;
  }): Promise<void>;
  approveAndAdvance(input: {
    projectId: string;
    kind: "plan" | "tasks";
    versionId: string;
    approvedBy: string;
    now: string;
  }): Promise<DocumentApprovalTransition>;
  getCurrentStage(projectId: string): Promise<SdvcStage>;
  setCurrentStage(projectId: string, stage: SdvcStage): Promise<void>;
  listVersions(projectId: string): Promise<DocumentVersion[]>;
  listApprovals(projectId: string): Promise<DocumentApproval[]>;
}

export async function approveDocumentAndAdvance(
  input: {
    projectId: string;
    kind: "plan" | "tasks";
    versionId: string;
    approvedBy: string;
    now: string;
  },
  dependencies: DocumentWorkflowDependencies,
): Promise<DocumentApprovalTransition> {
  return dependencies.approveAndAdvance(input);
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
