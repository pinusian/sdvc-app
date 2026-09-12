import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { adminCan, type AdminAction, type AdminActor } from "@/lib/admin/access";
import { recordAdminAction } from "@/lib/admin/audit";
import { loadAdminActor } from "@/lib/admin/entry";

/**
 * [P8-2] 관리자 라우트의 공통 관문.
 *
 * 관리자 라우트는 **세 가지를 반드시 함께** 해야 한다:
 *   ① `adminCan`으로 판정  ② 행위 수행  ③ 감사 로그
 * 라우트마다 따로 쓰면 언젠가 하나를 빠뜨린다 — 그러면 "누가 남의 계정을
 * 정지했는지 모르는" 상태가 된다. 그래서 ①과 ③을 여기 묶어 둔다.
 *
 * **관리자가 아니면 404**를 준다(403이 아니라). 403은 "여기 관리자 화면이
 * 있다"는 사실을 알려준다 — 산출물 서빙([P5-1])과 같은 원칙이다.
 */

export interface AdminContext {
  admin: SupabaseClient;
  actorId: string;
  actor: AdminActor;
}

type GuardResult = { ok: true; ctx: AdminContext } | { ok: false; response: NextResponse };

export async function requireAdmin(action: AdminAction): Promise<GuardResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  // [P8-11d] 판정에 쓰는 세 값을 읽는 자리는 한 곳뿐이다 — 화면과 API가
  // 서로 다른 방식으로 읽으면 한쪽만 고쳐지는 날이 온다.
  const actor: AdminActor = await loadAdminActor(admin, user.id);

  // 관리자가 아예 아니면 이런 화면이 있다는 것조차 알리지 않는다.
  if (actor.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 }),
    };
  }

  // 관리자이긴 하나 등급이 모자란 경우 — **거부된 시도도 증거다.**
  if (!adminCan(actor, action)) {
    await recordAdminAction(admin, {
      actorId: user.id,
      action,
      succeeded: false,
      detail: { denied: "등급 부족", tier: actor.adminTier },
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "이 작업을 할 권한이 없습니다." }, { status: 403 }),
    };
  }

  return { ok: true, ctx: { admin, actorId: user.id, actor } };
}

/**
 * 행위를 마친 뒤 감사 로그를 남기고, 실패했으면 응답에 실을 경고를 돌려준다.
 * **기록 실패로 행위를 되돌리지는 않는다** — 이미 일어난 일이고, 급한 차단이
 * 기록 문제로 막히면 안 된다. 대신 조용히 넘기지 않는다.
 */
export async function auditAndWarn(
  ctx: AdminContext,
  record: Omit<Parameters<typeof recordAdminAction>[1], "actorId">,
): Promise<{ auditWarning?: string }> {
  const result = await recordAdminAction(ctx.admin, { actorId: ctx.actorId, ...record });
  return result.recorded
    ? {}
    : { auditWarning: `감사 로그를 남기지 못했습니다: ${result.message}` };
}
