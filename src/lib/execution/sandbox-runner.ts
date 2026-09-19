export type TddPhase = "red" | "green";

export interface TddPhaseInput {
  phase: TddPhase;
  command: string;
  codeHash: string;
  testHash: string;
}

export interface TddVerificationRequest {
  runId: string;
  taskId: string;
  repository: string;
  revision: string;
  phases: readonly [TddPhaseInput, TddPhaseInput];
  signal?: AbortSignal;
}

export interface SandboxCommandInput extends TddPhaseInput {
  repository: string;
  revision: string;
  network: "none";
  environment: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface SandboxCommandResult {
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  outcome: "test_result" | "infrastructure_error";
  tests: {
    collected: number;
    passed: number;
    failed: number;
  };
}

export interface SandboxPort {
  run(input: SandboxCommandInput): Promise<SandboxCommandResult>;
}

export interface TddEvidence extends SandboxCommandResult {
  runId: string;
  taskId: string;
  phase: TddPhase;
  command: string;
  codeHash: string;
  testHash: string;
}

export interface TddVerificationResult {
  status: "verified" | "unverified" | "cancelled";
  reason?:
    | "invalid_plan"
    | "red_not_meaningful"
    | "green_failed"
    | "sandbox_error"
    | "cancelled";
  evidence: readonly TddEvidence[];
}

export interface TddVerificationDependencies {
  sandbox: SandboxPort;
}

export async function runTddVerification(
  request: TddVerificationRequest,
  dependencies: TddVerificationDependencies,
): Promise<TddVerificationResult> {
  if (!hasImmutableTestPlan(request.phases)) {
    return unverified("invalid_plan");
  }

  if (request.signal?.aborted) {
    return cancelled();
  }

  const evidence: TddEvidence[] = [];

  for (const phase of request.phases) {
    if (request.signal?.aborted) {
      return cancelled(evidence);
    }

    let result: SandboxCommandResult;
    try {
      result = await dependencies.sandbox.run({
        ...phase,
        repository: request.repository,
        revision: request.revision,
        network: "none",
        environment: {},
        signal: request.signal,
      });
    } catch (error) {
      return isAbortError(error) || request.signal?.aborted
        ? cancelled(evidence)
        : unverified("sandbox_error", evidence);
    }

    evidence.push(toEvidence(request, phase, result));

    if (result.outcome === "infrastructure_error") {
      return unverified("sandbox_error", evidence);
    }

    if (phase.phase === "red" && !isMeaningfulRed(result)) {
      return unverified("red_not_meaningful", evidence);
    }

    if (phase.phase === "green" && !isPassingGreen(result)) {
      return unverified("green_failed", evidence);
    }
  }

  return { status: "verified", evidence };
}

function hasImmutableTestPlan(
  phases: readonly [TddPhaseInput, TddPhaseInput],
): boolean {
  const [red, green] = phases;
  return (
    red.phase === "red" &&
    green.phase === "green" &&
    red.command === green.command &&
    red.testHash === green.testHash
  );
}

function isMeaningfulRed(result: SandboxCommandResult): boolean {
  return (
    result.exitCode !== 0 &&
    result.tests.collected > 0 &&
    result.tests.failed > 0
  );
}

function isPassingGreen(result: SandboxCommandResult): boolean {
  return (
    result.exitCode === 0 &&
    result.tests.collected > 0 &&
    result.tests.failed === 0 &&
    result.tests.passed === result.tests.collected
  );
}

function toEvidence(
  request: TddVerificationRequest,
  phase: TddPhaseInput,
  result: SandboxCommandResult,
): TddEvidence {
  return {
    runId: request.runId,
    taskId: request.taskId,
    phase: phase.phase,
    command: phase.command,
    codeHash: phase.codeHash,
    testHash: phase.testHash,
    ...result,
  };
}

function unverified(
  reason: Exclude<TddVerificationResult["reason"], "cancelled" | undefined>,
  evidence: readonly TddEvidence[] = [],
): TddVerificationResult {
  return { status: "unverified", reason, evidence };
}

function cancelled(
  evidence: readonly TddEvidence[] = [],
): TddVerificationResult {
  return { status: "cancelled", reason: "cancelled", evidence };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
