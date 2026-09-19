import { describe, expect, it, vi } from "vitest";
import {
  runTddVerification,
  type SandboxCommandInput,
  type SandboxCommandResult,
  type TddVerificationRequest,
} from "@/lib/execution/sandbox-runner";

const SECRET = "platform-management-secret";

const REQUEST: TddVerificationRequest = {
  runId: "run-008",
  taskId: "T008",
  repository: "sample://calculator",
  revision: "commit-green",
  phases: [
    {
      phase: "red",
      command: "npm test -- calculator.test.ts",
      codeHash: "sha256:code-red",
      testHash: "sha256:tests-v1",
    },
    {
      phase: "green",
      command: "npm test -- calculator.test.ts",
      codeHash: "sha256:code-green",
      testHash: "sha256:tests-v1",
    },
  ],
};

const RED: SandboxCommandResult = {
  startedAt: "2026-09-19T12:00:00.000Z",
  finishedAt: "2026-09-19T12:00:01.000Z",
  exitCode: 1,
  stdout: "1 test collected, 1 failed",
  stderr: "expected 4, received 0",
  outcome: "test_result",
  tests: { collected: 1, passed: 0, failed: 1 },
};

const GREEN: SandboxCommandResult = {
  startedAt: "2026-09-19T12:01:00.000Z",
  finishedAt: "2026-09-19T12:01:01.000Z",
  exitCode: 0,
  stdout: "1 test collected, 1 passed",
  stderr: "",
  outcome: "test_result",
  tests: { collected: 1, passed: 1, failed: 0 },
};

function sandboxWith(...results: SandboxCommandResult[]) {
  return {
    run: vi.fn<(input: SandboxCommandInput) => Promise<SandboxCommandResult>>()
      .mockImplementation(async () => {
        const result = results.shift();
        if (!result) throw new Error("unexpected sandbox call");
        return result;
      }),
  };
}

describe("[T008] 격리 TDD 실행 계약", () => {
  it("의미 있는 RED 실패 뒤 동일 테스트의 GREEN 성공을 검증한다", async () => {
    const sandbox = sandboxWith(RED, GREEN);

    const result = await runTddVerification(REQUEST, { sandbox });

    expect(result.status).toBe("verified");
    expect(result.evidence.map((item) => [item.phase, item.exitCode])).toEqual([
      ["red", 1],
      ["green", 0],
    ]);
    expect(sandbox.run).toHaveBeenCalledTimes(2);
  });

  it("RED에서 테스트가 0개 수집되면 유효한 실패로 인정하지 않는다", async () => {
    const sandbox = sandboxWith({
      ...RED,
      stdout: "No test files found",
      tests: { collected: 0, passed: 0, failed: 0 },
    });

    const result = await runTddVerification(REQUEST, { sandbox });

    expect(result).toMatchObject({ status: "unverified", reason: "red_not_meaningful" });
    expect(sandbox.run).toHaveBeenCalledTimes(1);
  });

  it("환경 설정 오류를 RED로 오인하지 않고 GREEN을 실행하지 않는다", async () => {
    const sandbox = sandboxWith({ ...RED, outcome: "infrastructure_error" });

    const result = await runTddVerification(REQUEST, { sandbox });

    expect(result).toMatchObject({ status: "unverified", reason: "sandbox_error" });
    expect(sandbox.run).toHaveBeenCalledTimes(1);
  });

  it("RED와 GREEN의 명령 또는 테스트 해시가 다르면 실행 전에 거부한다", async () => {
    const sandbox = sandboxWith(RED, GREEN);
    const changedTests: TddVerificationRequest = {
      ...REQUEST,
      phases: [REQUEST.phases[0], { ...REQUEST.phases[1], testHash: "sha256:weakened" }],
    };

    const result = await runTddVerification(changedTests, { sandbox });

    expect(result).toMatchObject({ status: "unverified", reason: "invalid_plan" });
    expect(sandbox.run).not.toHaveBeenCalled();
  });

  it("각 단계의 명령·시각·종료 코드·코드/테스트 해시·로그를 증거로 남긴다", async () => {
    const sandbox = sandboxWith(RED, GREEN);

    const result = await runTddVerification(REQUEST, { sandbox });

    expect(result.evidence[0]).toMatchObject({
      runId: "run-008",
      taskId: "T008",
      phase: "red",
      command: "npm test -- calculator.test.ts",
      startedAt: RED.startedAt,
      finishedAt: RED.finishedAt,
      exitCode: 1,
      codeHash: "sha256:code-red",
      testHash: "sha256:tests-v1",
      stdout: RED.stdout,
      stderr: RED.stderr,
    });
  });

  it("생성 코드 환경에는 플랫폼 비밀을 전달하지 않고 네트워크를 차단한다", async () => {
    const sandbox = sandboxWith(RED, GREEN);

    await runTddVerification(REQUEST, { sandbox });

    for (const [input] of sandbox.run.mock.calls) {
      expect(input.network).toBe("none");
      expect(input.environment).toEqual({});
      expect(JSON.stringify(input)).not.toContain(SECRET);
    }
  });

  it("이미 취소된 실행은 Sandbox를 시작하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const sandbox = sandboxWith(RED, GREEN);

    const result = await runTddVerification(
      { ...REQUEST, signal: controller.signal },
      { sandbox },
    );

    expect(result).toMatchObject({ status: "cancelled", reason: "cancelled", evidence: [] });
    expect(sandbox.run).not.toHaveBeenCalled();
  });
});
