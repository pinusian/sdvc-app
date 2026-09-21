import { describe, expect, it, vi } from "vitest";
import {
  executePersistentRun,
  type PersistentRunWorkerStore,
} from "@/lib/execution/persistent-run-worker";
import type { PersistentRun } from "@/lib/execution/persistent-runs";
import type {
  SandboxCommandResult,
  SandboxPort,
  TddVerificationRequest,
} from "@/lib/execution/sandbox-runner";

const STARTED_AT = "2026-09-21T10:00:00.000Z";
const FINISHED_AT = "2026-09-21T10:00:02.000Z";
const BUNDLE_HASH = "a".repeat(64);
const TEST_HASH = "b".repeat(64);

const RUN: PersistentRun = {
  id: "run-034",
  ownerId: "learner-1",
  projectId: "project-1",
  documentBundleHash: BUNDLE_HASH,
  idempotencyKey: "project-1:bundle-a",
  status: "running",
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
};

const VERIFICATION: TddVerificationRequest = {
  runId: RUN.id,
  taskId: "T034",
  repository: "artifact://project-1/bundle-a",
  phases: [
    {
      phase: "red",
      command: "npm test -- generated.test.ts",
      sourceRevision: "1".repeat(40),
      codeHash: "c".repeat(64),
      testHash: TEST_HASH,
    },
    {
      phase: "green",
      command: "npm test -- generated.test.ts",
      sourceRevision: "2".repeat(40),
      codeHash: "d".repeat(64),
      testHash: TEST_HASH,
    },
  ],
};

const RED: SandboxCommandResult = {
  startedAt: STARTED_AT,
  finishedAt: "2026-09-21T10:00:01.000Z",
  exitCode: 1,
  stdout: "1 test collected, 1 failed",
  stderr: "expected 4, received 0",
  outcome: "test_result",
  tests: { collected: 1, passed: 0, failed: 1 },
};

const GREEN: SandboxCommandResult = {
  startedAt: "2026-09-21T10:00:01.000Z",
  finishedAt: FINISHED_AT,
  exitCode: 0,
  stdout: "1 test collected, 1 passed",
  stderr: "",
  outcome: "test_result",
  tests: { collected: 1, passed: 1, failed: 0 },
};

function storeWithLease(run: PersistentRun | null = RUN): PersistentRunWorkerStore {
  return {
    isLearnerActive: vi.fn().mockResolvedValue(true),
    findByIdempotency: vi.fn().mockResolvedValue(null),
    insertRun: vi.fn(),
    getOwnedRun: vi.fn().mockResolvedValue(run),
    listEvents: vi.fn().mockResolvedValue([]),
    requestCancellation: vi.fn(),
    claimLease: vi.fn().mockResolvedValue(run),
    appendEvent: vi.fn(async (input) => ({
      id: crypto.randomUUID(),
      runId: input.runId,
      sequence: 1,
      type: input.type,
      payload: input.payload,
      createdAt: input.createdAt,
    })),
    insertTestEvidence: vi.fn().mockResolvedValue(undefined),
    finishRun: vi.fn().mockResolvedValue(undefined),
  };
}

function sandboxWith(...results: SandboxCommandResult[]): SandboxPort {
  return {
    run: vi.fn(async () => {
      const result = results.shift();
      if (!result) throw new Error("unexpected sandbox call");
      return result;
    }),
  };
}

function workerInput(overrides: Partial<Parameters<typeof executePersistentRun>[0]> = {}) {
  return {
    runId: RUN.id,
    workerId: "workflow-run-034",
    documentBundleHash: BUNDLE_HASH,
    startedAt: STARTED_AT,
    leaseExpiresAt: "2026-09-21T10:05:00.000Z",
    verification: VERIFICATION,
    ...overrides,
  };
}

describe("[T034] Workflow worker와 Sandbox 영속 증거 연결", () => {
  it("lease를 획득한 worker만 RED→GREEN을 실행하고 불변 해시 증거를 저장한다", async () => {
    const store = storeWithLease();
    const sandbox = sandboxWith(RED, GREEN);

    const result = await executePersistentRun(workerInput(), { store, sandbox });

    expect(result).toMatchObject({ status: "executed", verification: { status: "verified" } });
    expect(store.claimLease).toHaveBeenCalledWith({
      runId: RUN.id,
      workerId: "workflow-run-034",
      now: STARTED_AT,
      leaseExpiresAt: "2026-09-21T10:05:00.000Z",
    });
    expect(store.insertTestEvidence).toHaveBeenCalledTimes(2);
    expect(store.insertTestEvidence).toHaveBeenNthCalledWith(1, expect.objectContaining({
      runId: RUN.id,
      phase: "red",
      codeHash: VERIFICATION.phases[0].codeHash,
      testHash: TEST_HASH,
      exitCode: 1,
      logPath: `run-events://${RUN.id}/tdd-evidence/red`,
    }));
    expect(store.finishRun).toHaveBeenCalledWith({
      runId: RUN.id,
      workerId: "workflow-run-034",
      status: "succeeded",
      finishedAt: FINISHED_AT,
    });
  });

  it("다른 worker가 유효 lease를 보유하면 Sandbox를 중복 실행하지 않는다", async () => {
    const store = storeWithLease(null);
    const sandbox = sandboxWith(RED, GREEN);

    await expect(executePersistentRun(workerInput(), { store, sandbox })).resolves.toEqual({
      status: "skipped",
    });
    expect(sandbox.run).not.toHaveBeenCalled();
    expect(store.insertTestEvidence).not.toHaveBeenCalled();
    expect(store.finishRun).not.toHaveBeenCalled();
  });

  it("작업의 승인 문서 묶음 해시와 실행 입력이 다르면 Sandbox 전에 실패 처리한다", async () => {
    const store = storeWithLease();
    const sandbox = sandboxWith(RED, GREEN);

    const result = await executePersistentRun(
      workerInput({ documentBundleHash: "e".repeat(64) }),
      { store, sandbox },
    );

    expect(result).toMatchObject({
      status: "executed",
      verification: { status: "unverified", reason: "invalid_plan" },
    });
    expect(sandbox.run).not.toHaveBeenCalled();
    expect(store.finishRun).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("의미 없는 RED나 실패한 GREEN은 성공으로 기록하지 않는다", async () => {
    const store = storeWithLease();
    const sandbox = sandboxWith({
      ...RED,
      exitCode: 0,
      tests: { collected: 1, passed: 1, failed: 0 },
    });

    const result = await executePersistentRun(workerInput(), { store, sandbox });

    expect(result).toMatchObject({
      status: "executed",
      verification: { status: "unverified", reason: "red_not_meaningful" },
    });
    expect(store.finishRun).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("Sandbox 로그는 run event에 저장하고 evidence가 그 불변 경로를 가리킨다", async () => {
    const store = storeWithLease();

    await executePersistentRun(workerInput(), { store, sandbox: sandboxWith(RED, GREEN) });

    expect(store.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN.id,
      type: "tdd_evidence",
      payload: expect.objectContaining({
        phase: "red",
        stdout: RED.stdout,
        stderr: RED.stderr,
        codeHash: VERIFICATION.phases[0].codeHash,
        testHash: TEST_HASH,
      }),
    }));
  });
});
