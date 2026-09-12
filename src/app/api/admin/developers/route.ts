import { NextResponse } from "next/server";
import { requireAdmin, auditAndWarn } from "@/lib/admin/guard";
import { extendTrial, listDevelopers, setSuspended } from "@/lib/admin/developers";

/**
 * [P8-2] 개발자 관리 (FR-014).
 *
 * GET  — 목록 (보는 것도 감사 로그에 남는다)
 * POST — 정지 / 해제 / 체험연장
 */

export async function GET(request: Request) {
  const guard = await requireAdmin("developer:read");
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams.get("search") ?? undefined;
  const developers = await listDevelopers(guard.ctx.admin, { search });

  // 열람도 기록 대상이다(Clarify 20) — "남의 목록을 언제 보았느냐"에 답할 수 있어야 한다.
  const warn = await auditAndWarn(guard.ctx, {
    action: "developer:read",
    detail: { count: developers.length, ...(search ? { search } : {}) },
  });

  return NextResponse.json({ developers, ...warn });
}

/** 할 수 있는 일 → 필요한 권한 */
const ACTIONS = {
  suspend: "developer:suspend",
  unsuspend: "developer:suspend",
  extend_trial: "developer:extend_trial",
} as const;

type ActionName = keyof typeof ACTIONS;

export async function POST(request: Request) {
  let body: { userId?: unknown; action?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const action = typeof body.action === "string" ? (body.action as ActionName) : ("" as ActionName);
  const reason = typeof body.reason === "string" ? body.reason : null;

  if (!userId || !(action in ACTIONS)) {
    return NextResponse.json({ error: "무엇을 할지 알 수 없습니다." }, { status: 400 });
  }

  const guard = await requireAdmin(ACTIONS[action]);
  if (!guard.ok) return guard.response;

  // 스스로를 잠그면 풀어줄 사람이 없다.
  if (userId === guard.ctx.actorId && action === "suspend") {
    return NextResponse.json({ error: "자기 계정은 정지할 수 없습니다." }, { status: 400 });
  }

  try {
    if (action === "extend_trial") {
      const { data } = await guard.ctx.admin
        .from("profiles")
        .select("trial_ends_at")
        .eq("id", userId)
        .maybeSingle();
      const current = (data as { trial_ends_at: string | null } | null)?.trial_ends_at ?? null;
      const until = await extendTrial(guard.ctx.admin, userId, current);

      const warn = await auditAndWarn(guard.ctx, {
        action: "developer:extend_trial",
        targetType: "profile",
        targetId: userId,
        detail: { until },
      });
      return NextResponse.json({ trialEndsAt: until, ...warn });
    }

    const suspended = action === "suspend";
    await setSuspended(guard.ctx.admin, userId, suspended, reason);

    const warn = await auditAndWarn(guard.ctx, {
      action: "developer:suspend",
      targetType: "profile",
      targetId: userId,
      detail: { suspended, ...(reason ? { reason } : {}) },
    });
    return NextResponse.json({ suspended, ...warn });
  } catch (error) {
    await auditAndWarn(guard.ctx, {
      action: ACTIONS[action],
      targetType: "profile",
      targetId: userId,
      succeeded: false,
      detail: { error: error instanceof Error ? error.message : "알 수 없는 오류" },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "처리하지 못했습니다." },
      { status: 500 },
    );
  }
}
