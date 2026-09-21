// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: createMock },
}));

import { createVercelSandboxPort } from "@/lib/execution/vercel-sandbox-port";

const INPUT = {
  phase: "red" as const,
  command: "npm test -- generated.test.ts",
  sourceRevision: "1".repeat(40),
  revision: "1".repeat(40),
  codeHash: "c".repeat(64),
  testHash: "b".repeat(64),
  repository: "https://github.com/example/generated-app.git",
  network: "none" as const,
  environment: {},
};

function command(exitCode: number, stdout: string, stderr = "") {
  return {
    exitCode,
    startedAt: Date.parse("2026-09-21T12:00:00.000Z"),
    durationMs: 1_000,
    stdout: vi.fn().mockResolvedValue(stdout),
    stderr: vi.fn().mockResolvedValue(stderr),
  };
}

function fakeSandbox(...commands: ReturnType<typeof command>[]) {
  return {
    runCommand: vi.fn().mockImplementation(async () => commands.shift()),
    updateNetworkPolicy: vi.fn().mockResolvedValue("deny-all"),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

describe("[T034] Vercel Sandbox 어댑터", () => {
  beforeEach(() => createMock.mockReset());

  it("의존성 설치 후 네트워크를 닫고 불변 revision의 테스트 결과를 읽는다", async () => {
    const sandbox = fakeSandbox(
      command(0, "installed"),
      command(1, "Tests  1 failed | 2 passed (3)"),
    );
    createMock.mockResolvedValue(sandbox);

    const result = await createVercelSandboxPort().run(INPUT);

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ revision: INPUT.revision, depth: 1 }),
      resources: { vcpus: 1 },
      persistent: false,
      timeout: 120_000,
      networkPolicy: { allow: ["registry.npmjs.org"] },
      env: {},
    }));
    expect(sandbox.updateNetworkPolicy).toHaveBeenCalledWith("deny-all", { signal: undefined });
    expect(sandbox.runCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cmd: "bash",
      args: ["-lc", INPUT.command],
      cwd: "generated-app",
      env: {},
    }));
    expect(result).toMatchObject({
      outcome: "test_result",
      exitCode: 1,
      tests: { collected: 3, passed: 2, failed: 1 },
    });
    expect(sandbox.stop).toHaveBeenCalledOnce();
  });

  it("의존성 설치 실패는 RED가 아닌 인프라 오류로 남기고 Sandbox를 종료한다", async () => {
    const sandbox = fakeSandbox(command(1, "", "npm ci failed"));
    createMock.mockResolvedValue(sandbox);

    const result = await createVercelSandboxPort().run(INPUT);

    expect(result).toMatchObject({
      outcome: "infrastructure_error",
      tests: { collected: 0, passed: 0, failed: 0 },
    });
    expect(sandbox.updateNetworkPolicy).not.toHaveBeenCalled();
    expect(sandbox.stop).toHaveBeenCalledOnce();
  });

  it("공개 GitHub HTTPS 저장소가 아니면 Sandbox를 만들지 않는다", async () => {
    await expect(createVercelSandboxPort().run({
      ...INPUT,
      repository: "https://token@example.com/private.git",
    })).rejects.toThrow("public HTTPS GitHub repository");

    expect(createMock).not.toHaveBeenCalled();
  });
});
