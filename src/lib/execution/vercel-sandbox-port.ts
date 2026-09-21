import { Sandbox } from "@vercel/sandbox";
import type {
  SandboxCommandResult,
  SandboxPort,
} from "@/lib/execution/sandbox-runner";

const COMMAND_TIMEOUT_MS = 90_000;

export function createVercelSandboxPort(): SandboxPort {
  return {
    async run(input) {
      const repository = requirePublicGithubRepository(input.repository);
      const cwd = repositoryName(repository);
      let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | undefined;

      try {
        sandbox = await Sandbox.create({
          source: {
            type: "git",
            url: repository.toString(),
            revision: input.revision,
            depth: 1,
          },
          resources: { vcpus: 1 },
          persistent: false,
          timeout: 120_000,
          networkPolicy: { allow: ["registry.npmjs.org"] },
          env: {},
          signal: input.signal,
          tags: { purpose: "sdvc-tdd" },
        });

        const install = await sandbox.runCommand({
          cmd: "npm",
          args: ["ci", "--no-audit", "--no-fund"],
          cwd,
          env: {},
          signal: input.signal,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        if (install.exitCode !== 0) {
          return commandResult(install, "infrastructure_error", {
            collected: 0,
            passed: 0,
            failed: 0,
          });
        }

        await sandbox.updateNetworkPolicy("deny-all", { signal: input.signal });
        const command = await sandbox.runCommand({
          cmd: "bash",
          args: ["-lc", input.command],
          cwd,
          env: { ...input.environment },
          signal: input.signal,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        const stdout = await command.stdout({ signal: input.signal });
        const stderr = await command.stderr({ signal: input.signal });
        const tests = parseTestCounts(`${stdout}\n${stderr}`);

        return commandResult(
          command,
          tests ? "test_result" : "infrastructure_error",
          tests ?? { collected: 0, passed: 0, failed: 0 },
          stdout,
          stderr,
        );
      } finally {
        if (sandbox) await sandbox.stop();
      }
    },
  };
}

function requirePublicGithubRepository(value: string): URL {
  const repository = new URL(value);
  if (
    repository.protocol !== "https:" ||
    repository.hostname !== "github.com" ||
    repository.username ||
    repository.password ||
    repository.search ||
    repository.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(repository.pathname)
  ) {
    throw new Error("Sandbox source must be a public HTTPS GitHub repository.");
  }
  return repository;
}

function repositoryName(repository: URL): string {
  const name = repository.pathname.split("/").filter(Boolean).at(-1)?.replace(/\.git$/, "");
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error("Invalid repository name.");
  }
  return name;
}

type FinishedCommand = Awaited<ReturnType<Awaited<ReturnType<typeof Sandbox.create>>["runCommand"]>>;

async function commandResult(
  command: FinishedCommand,
  outcome: SandboxCommandResult["outcome"],
  tests: SandboxCommandResult["tests"],
  stdout?: string,
  stderr?: string,
): Promise<SandboxCommandResult> {
  const startedAt = new Date(command.startedAt).toISOString();
  const finishedAt = new Date(command.startedAt + (command.durationMs ?? 0)).toISOString();
  return {
    startedAt,
    finishedAt,
    exitCode: command.exitCode,
    stdout: stdout ?? await command.stdout(),
    stderr: stderr ?? await command.stderr(),
    outcome,
    tests,
  };
}

function parseTestCounts(output: string): SandboxCommandResult["tests"] | null {
  if (/No test files found/i.test(output)) {
    return { collected: 0, passed: 0, failed: 0 };
  }

  const vitest = output.match(
    /Tests\s+(?:(\d+)\s+failed(?:\s*\|\s*)?)?(?:(\d+)\s+passed)?(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/i,
  );
  if (vitest) {
    return {
      failed: Number(vitest[1] ?? 0),
      passed: Number(vitest[2] ?? 0),
      collected: Number(vitest[4]),
    };
  }

  const jest = output.match(
    /Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/i,
  );
  return jest
    ? { failed: Number(jest[1] ?? 0), passed: Number(jest[2] ?? 0), collected: Number(jest[3]) }
    : null;
}
