import { NextResponse } from "next/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { createPersistentRunStore } from "@/lib/execution/persistent-run-store";
import { createPersistentRun, resumePersistentRun } from "@/lib/execution/persistent-runs";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;

  let body: { idempotencyKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ error: "새 재시도 식별값이 필요합니다." }, { status: 400 });
  }

  const { runId } = await context.params;
  const store = createPersistentRunStore(createAdminClient());
  try {
    const { run: previous } = await resumePersistentRun(
      { runId, ownerId: access.user.id },
      store,
    );
    if (previous.status !== "failed" && previous.status !== "cancelled") {
      return NextResponse.json(
        { error: "실패하거나 취소된 실행만 다시 시도할 수 있습니다." },
        { status: 409 },
      );
    }
    const run = await createPersistentRun(
      {
        ownerId: access.user.id,
        projectId: previous.projectId,
        documentBundleHash: previous.documentBundleHash,
        idempotencyKey,
        now: new Date().toISOString(),
      },
      store,
    );
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "재시도 실행을 만들지 못했습니다.";
    return NextResponse.json(
      { error: message },
      { status: /찾을 수 없습니다/.test(message) ? 404 : 409 },
    );
  }
}
