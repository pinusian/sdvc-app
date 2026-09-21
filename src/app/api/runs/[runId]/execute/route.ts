import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { createPersistentRunStore } from "@/lib/execution/persistent-run-store";
import type { TddPhaseInput } from "@/lib/execution/sandbox-runner";
import { createAdminClient } from "@/lib/supabase/server";
import { executePersistentRunWorkflow } from "@/workflows/execute-persistent-run";

interface ExecuteBody {
  taskId?: unknown;
  repository?: unknown;
  phases?: unknown;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.ENABLE_VERCEL_SANDBOX !== "true"
  ) {
    return NextResponse.json(
      { error: "Preview Sandbox 실행이 비활성화되어 있습니다." },
      { status: 503 },
    );
  }

  const { runId } = await context.params;
  const store = createPersistentRunStore(createAdminClient());
  const run = await store.getOwnedRun(runId, access.user.id);
  if (!run) {
    return NextResponse.json({ error: "실행을 찾을 수 없습니다." }, { status: 404 });
  }
  if (run.status !== "queued") {
    return NextResponse.json({ error: "대기 중인 실행만 시작할 수 있습니다." }, { status: 409 });
  }

  let body: ExecuteBody;
  try {
    body = (await request.json()) as ExecuteBody;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const repository = typeof body.repository === "string" ? body.repository : "";
  const phases = parsePhases(body.phases);
  if (!/^T\d+$/.test(taskId) || !isPublicGithubRepository(repository) || !phases) {
    return NextResponse.json({ error: "실행 입력이 올바르지 않습니다." }, { status: 400 });
  }

  const workflowRun = await start(executePersistentRunWorkflow, [{
    runId: run.id,
    workerId: crypto.randomUUID(),
    documentBundleHash: run.documentBundleHash,
    verification: { runId: run.id, taskId, repository, phases },
  }]);

  return NextResponse.json(
    { runId: run.id, workflowRunId: workflowRun.runId, status: "queued" },
    { status: 202 },
  );
}

function parsePhases(value: unknown): readonly [TddPhaseInput, TddPhaseInput] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const phases = value.map(parsePhase);
  const [red, green] = phases;
  if (!red || !green) return null;
  if (
    red.phase !== "red" ||
    green.phase !== "green" ||
    red.command !== green.command ||
    red.testHash !== green.testHash
  ) return null;
  return [red, green];
}

function parsePhase(value: unknown): TddPhaseInput | null {
  if (!value || typeof value !== "object") return null;
  const phase = value as Record<string, unknown>;
  if (
    (phase.phase !== "red" && phase.phase !== "green") ||
    typeof phase.command !== "string" ||
    !/^npm (?:test|run test)(?:\s|$)/.test(phase.command) ||
    typeof phase.sourceRevision !== "string" ||
    !/^[a-f0-9]{40,64}$/.test(phase.sourceRevision) ||
    typeof phase.codeHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(phase.codeHash) ||
    typeof phase.testHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(phase.testHash)
  ) return null;

  return {
    phase: phase.phase,
    command: phase.command,
    sourceRevision: phase.sourceRevision,
    codeHash: phase.codeHash,
    testHash: phase.testHash,
  };
}

function isPublicGithubRepository(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
