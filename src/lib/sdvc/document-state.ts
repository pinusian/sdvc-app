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
}

export function hashDocumentContent(_content: string): string {
  void _content;
  throw new Error("T027 document hashing is not implemented");
}

export async function saveDocumentVersion(
  _input: {
    projectId: string;
    kind: DocumentKind;
    content: string;
    now: string;
  },
  _dependencies: DocumentWorkflowDependencies,
): Promise<DocumentVersion> {
  void _input;
  void _dependencies;
  throw new Error("T027 document versioning is not implemented");
}

export async function approveDocumentVersion(
  _input: {
    projectId: string;
    kind: "plan" | "tasks";
    versionId: string;
    approvedBy: string;
    now: string;
  },
  _dependencies: DocumentWorkflowDependencies,
): Promise<DocumentApproval> {
  void _input;
  void _dependencies;
  throw new Error("T027 document approval is not implemented");
}

export async function advanceDocumentStage(
  _input: { projectId: string; expectedStage: SdvcStage },
  _dependencies: DocumentWorkflowDependencies,
): Promise<SdvcStage> {
  void _input;
  void _dependencies;
  throw new Error("T027 document stage transition is not implemented");
}
