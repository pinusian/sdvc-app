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

export interface TestEvidenceRecord {
  runId: string;
  phase: "red" | "green" | "refactor";
  codeHash: string;
  testHash: string;
  command: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  logPath: string | null;
}

export interface PersistentRunDependencies {
  isLearnerActive(ownerId: string): Promise<boolean>;
  findByIdempotency(ownerId: string, idempotencyKey: string): Promise<PersistentRun | null>;
  insertRun(input: Omit<PersistentRun, "id">): Promise<PersistentRun>;
  getOwnedRun(runId: string, ownerId: string): Promise<PersistentRun | null>;
  listEvents(runId: string): Promise<PersistentRunEvent[]>;
  requestCancellation(runId: string, now: string): Promise<PersistentRun>;
}

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
  await requireActiveLearner(input.ownerId, dependencies);
  if (!/^[a-f0-9]{64}$/.test(input.documentBundleHash)) {
    throw new Error("승인 문서 묶음 해시가 올바르지 않습니다.");
  }
  if (!input.idempotencyKey.trim()) throw new Error("작업 멱등키가 필요합니다.");

  const existing = await dependencies.findByIdempotency(
    input.ownerId,
    input.idempotencyKey,
  );
  if (existing) {
    if (
      existing.projectId !== input.projectId ||
      existing.documentBundleHash !== input.documentBundleHash
    ) {
      throw new Error("같은 멱등키를 다른 프로젝트나 문서 묶음에 사용할 수 없습니다.");
    }
    return existing;
  }

  return dependencies.insertRun({
    ownerId: input.ownerId,
    projectId: input.projectId,
    documentBundleHash: input.documentBundleHash,
    idempotencyKey: input.idempotencyKey,
    status: "queued",
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export async function getPersistentRun(
  input: { runId: string; ownerId: string },
  dependencies: PersistentRunDependencies,
): Promise<{ run: PersistentRun; events: PersistentRunEvent[] }> {
  const run = await dependencies.getOwnedRun(input.runId, input.ownerId);
  if (!run) throw new Error("작업을 찾을 수 없습니다.");
  const events = await dependencies.listEvents(run.id);
  return { run, events: [...events].sort((left, right) => left.sequence - right.sequence) };
}

export async function cancelPersistentRun(
  input: { runId: string; ownerId: string; now: string },
  dependencies: PersistentRunDependencies,
): Promise<PersistentRun> {
  const run = await dependencies.getOwnedRun(input.runId, input.ownerId);
  if (!run) throw new Error("작업을 찾을 수 없습니다.");
  if (run.status === "cancel_requested" || isTerminal(run.status)) return run;
  return dependencies.requestCancellation(run.id, input.now);
}

export async function resumePersistentRun(
  input: { runId: string; ownerId: string },
  dependencies: PersistentRunDependencies,
): Promise<{ run: PersistentRun; events: PersistentRunEvent[] }> {
  await requireActiveLearner(input.ownerId, dependencies);
  return getPersistentRun(input, dependencies);
}

async function requireActiveLearner(
  ownerId: string,
  dependencies: PersistentRunDependencies,
) {
  if (!(await dependencies.isLearnerActive(ownerId))) {
    throw new Error("차단되었거나 비활성인 수강생은 작업을 생성하거나 재개할 수 없습니다.");
  }
}

function isTerminal(status: PersistentRunStatus) {
  return status === "cancelled" || status === "succeeded" || status === "failed";
}
