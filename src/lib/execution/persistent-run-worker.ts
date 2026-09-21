import type { PersistentRunStore } from "@/lib/execution/persistent-run-store";
import type {
  SandboxPort,
  TddVerificationRequest,
  TddVerificationResult,
} from "@/lib/execution/sandbox-runner";
import { runTddVerification } from "@/lib/execution/sandbox-runner";

export interface PersistentRunWorkerStore extends PersistentRunStore {
  finishRun(input: {
    runId: string;
    workerId: string;
    status: "cancelled" | "succeeded" | "failed";
    finishedAt: string;
  }): Promise<void>;
}

export interface PersistentRunWorkerInput {
  runId: string;
  workerId: string;
  documentBundleHash: string;
  startedAt: string;
  leaseExpiresAt: string;
  verification: TddVerificationRequest;
  signal?: AbortSignal;
}

export interface PersistentRunWorkerResult {
  status: "executed" | "skipped";
  verification?: TddVerificationResult;
}

export async function executePersistentRun(
  input: PersistentRunWorkerInput,
  dependencies: { store: PersistentRunWorkerStore; sandbox: SandboxPort },
): Promise<PersistentRunWorkerResult> {
  const leasedRun = await dependencies.store.claimLease({
    runId: input.runId,
    workerId: input.workerId,
    now: input.startedAt,
    leaseExpiresAt: input.leaseExpiresAt,
  });
  if (!leasedRun) return { status: "skipped" };

  await dependencies.store.appendEvent({
    runId: input.runId,
    type: "worker_started",
    payload: { workerId: input.workerId },
    createdAt: input.startedAt,
    dedupeKey: `worker:${input.workerId}:started`,
  });

  const immutableInputMatches =
    leasedRun.documentBundleHash === input.documentBundleHash &&
    input.verification.runId === input.runId;

  const verification: TddVerificationResult = immutableInputMatches
    ? await runTddVerification(
        { ...input.verification, signal: input.signal },
        { sandbox: dependencies.sandbox },
      )
    : { status: "unverified", reason: "invalid_plan", evidence: [] };

  for (const evidence of verification.evidence) {
    const logPath = `run-events://${input.runId}/tdd-evidence/${evidence.phase}`;
    await dependencies.store.appendEvent({
      runId: input.runId,
      type: "tdd_evidence",
      payload: {
        taskId: evidence.taskId,
        phase: evidence.phase,
        command: evidence.command,
        codeHash: evidence.codeHash,
        testHash: evidence.testHash,
        startedAt: evidence.startedAt,
        finishedAt: evidence.finishedAt,
        exitCode: evidence.exitCode,
        outcome: evidence.outcome,
        tests: evidence.tests,
        stdout: evidence.stdout,
        stderr: evidence.stderr,
      },
      createdAt: evidence.finishedAt,
      dedupeKey: `tdd:${evidence.phase}:${evidence.codeHash}:${evidence.testHash}`,
    });
    await dependencies.store.insertTestEvidence({
      runId: evidence.runId,
      phase: evidence.phase,
      codeHash: evidence.codeHash,
      testHash: evidence.testHash,
      command: evidence.command,
      startedAt: evidence.startedAt,
      finishedAt: evidence.finishedAt,
      exitCode: evidence.exitCode,
      logPath,
    });
  }

  const finishedAt = verification.evidence.at(-1)?.finishedAt ?? input.startedAt;
  const status =
    verification.status === "verified"
      ? "succeeded"
      : verification.status === "cancelled"
        ? "cancelled"
        : "failed";

  await dependencies.store.appendEvent({
    runId: input.runId,
    type: "worker_finished",
    payload: { status, reason: verification.reason ?? null },
    createdAt: finishedAt,
    dedupeKey: `worker:${input.workerId}:finished`,
  });
  await dependencies.store.finishRun({
    runId: input.runId,
    workerId: input.workerId,
    status,
    finishedAt,
  });

  return { status: "executed", verification };
}
