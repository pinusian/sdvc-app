import type { PersistentRunStore } from "@/lib/execution/persistent-run-store";
import type {
  SandboxPort,
  TddVerificationRequest,
  TddVerificationResult,
} from "@/lib/execution/sandbox-runner";

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
  _input: PersistentRunWorkerInput,
  _dependencies: { store: PersistentRunWorkerStore; sandbox: SandboxPort },
): Promise<PersistentRunWorkerResult> {
  throw new Error("T034 persistent run worker is not implemented");
}
