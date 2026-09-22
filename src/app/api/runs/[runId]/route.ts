import { NextResponse } from "next/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { createPersistentRunStore } from "@/lib/execution/persistent-run-store";
import { cancelPersistentRun, resumePersistentRun } from "@/lib/execution/persistent-runs";
import { createAdminClient } from "@/lib/supabase/server";

interface RunContext {
  params: Promise<{ runId: string }>;
}

export async function GET(_request: Request, context: RunContext) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { runId } = await context.params;

  try {
    const result = await resumePersistentRun(
      { runId, ownerId: access.user.id },
      createPersistentRunStore(createAdminClient()),
    );
    return NextResponse.json(result);
  } catch (error) {
    return runError(error);
  }
}

export async function DELETE(_request: Request, context: RunContext) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { runId } = await context.params;

  try {
    const run = await cancelPersistentRun(
      { runId, ownerId: access.user.id, now: new Date().toISOString() },
      createPersistentRunStore(createAdminClient()),
    );
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return runError(error);
  }
}

function runError(error: unknown) {
  const message = error instanceof Error ? error.message : "실행 상태를 처리하지 못했습니다.";
  return NextResponse.json(
    { error: message },
    { status: /찾을 수 없습니다/.test(message) ? 404 : 409 },
  );
}
