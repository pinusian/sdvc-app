export type PersistentRunStatus =
  | "queued"
  | "running"
  | "cancel_requested"
  | "cancelled"
  | "succeeded"
  | "failed";

export interface PersistentRun {
  id: string;
  ownerId: string;
  projectId: string;
  documentBundleHash: string;
  idempotencyKey: string;
  status: PersistentRunStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PersistentRunEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PersistentRunDependencies {
  isLearnerActive(ownerId: string): Promise<boolean>;
  findByIdempotency(ownerId: string, idempotencyKey: string): Promise<PersistentRun | null>;
  insertRun(input: Omit<PersistentRun, "id">): Promise<PersistentRun>;
  getOwnedRun(runId: string, ownerId: string): Promise<PersistentRun | null>;
  listEvents(runId: string): Promise<PersistentRunEvent[]>;
  requestCancellation(runId: string, now: string): Promise<PersistentRun>;
}

const NOT_IMPLEMENTED = "T032 지속 작업 실행 계약이 아직 구현되지 않았습니다.";

export async function createPersistentRun(
  input: {
    ownerId: string;
    projectId: string;
    documentBundleHash: string;
    idempotencyKey: string;
    now: string;
  },
  dependencies: PersistentRunDependencies,
): Promise<PersistentRun> {
  void input;
  void dependencies;
  throw new Error(NOT_IMPLEMENTED);
}

export async function getPersistentRun(
  input: { runId: string; ownerId: string },
  dependencies: PersistentRunDependencies,
): Promise<{ run: PersistentRun; events: PersistentRunEvent[] }> {
  void input;
  void dependencies;
  throw new Error(NOT_IMPLEMENTED);
}

export async function cancelPersistentRun(
  input: { runId: string; ownerId: string; now: string },
  dependencies: PersistentRunDependencies,
): Promise<PersistentRun> {
  void input;
  void dependencies;
  throw new Error(NOT_IMPLEMENTED);
}

export async function resumePersistentRun(
  input: { runId: string; ownerId: string },
  dependencies: PersistentRunDependencies,
): Promise<{ run: PersistentRun; events: PersistentRunEvent[] }> {
  void input;
  void dependencies;
  throw new Error(NOT_IMPLEMENTED);
}
