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
  _request: TddVerificationRequest,
  _dependencies: TddVerificationDependencies,
): Promise<TddVerificationResult> {
  throw new Error("T008 Sandbox execution contract is not implemented");
}
