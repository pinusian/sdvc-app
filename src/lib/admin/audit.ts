import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminAction } from "@/lib/admin/access";

/**
 * [P8-7a] 감사 로그 (FR-017).
 *
 * 관리자가 남의 데이터를 **본 것까지** 남긴다 — 분쟁에서 "남의 대화를
 * 엿보았느냐"는 변경만큼 중요한 질문이다(Clarify 20).
 *
 * **거부된 시도도 남긴다.** 누가 무엇을 하려 했는지가 증거다.
 *
 * 보는 **화면은 지금 만들지 않는다.** 기록은 지금부터 쌓이고, 필요할 때
 * 화면만 붙이면 된다 — 반대로 기록을 나중에 붙이면 그때까지의 행위는
 * 영영 증거가 없다.
 *
 * `admin_audit_logs`는 RLS를 켜고 정책을 두지 않았다(0008) = 서버 전용.
 * 감사 로그를 당사자가 지울 수 있으면 증거가 아니다.
 */

export interface AdminActionRecord {
  actorId: string;
  action: AdminAction;
  targetType?: string;
  targetId?: string;
  /** 거부된 시도면 false. 기본은 성공. */
  succeeded?: boolean;
  detail?: Record<string, unknown>;
}

export type RecordResult = { recorded: true } | { recorded: false; message: string };

/**
 * 관리자 행위를 남긴다.
 *
 * **예외를 던지지 않는다** — 기록 실패로 본 행위를 막으면, 정작 급할 때
 * (불법 콘텐츠 차단) 손이 묶인다. 대신 실패했다는 사실을 돌려주어
 * 부르는 쪽이 조용히 넘기지 않게 한다.
 */
export async function recordAdminAction(
  admin: SupabaseClient,
  { actorId, action, targetType, targetId, succeeded = true, detail }: AdminActionRecord,
): Promise<RecordResult> {
  try {
    const { error } = await admin
      .from("admin_audit_logs")
      .insert({
        actor_id: actorId,
        action,
        target_type: targetType ?? null,
        target_id: targetId ?? null,
        succeeded,
        detail: detail ?? null,
      })
      .select("id")
      .single();

    if (error) return { recorded: false, message: error.message };
    return { recorded: true };
  } catch (error) {
    return {
      recorded: false,
      message: error instanceof Error ? error.message : "감사 로그를 남기지 못했습니다.",
    };
  }
}

export interface AuditLogRow {
  id: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  succeeded: boolean;
  detail: Record<string, unknown> | null;
  created_at: string;
}

/** 기록을 읽어온다 (최신부터). 보는 화면은 나중에 붙인다. */
export async function listAuditLogs(
  admin: SupabaseClient,
  { actorId, limit = 100 }: { actorId?: string; limit?: number } = {},
): Promise<AuditLogRow[]> {
  let query = admin
    .from("admin_audit_logs")
    .select("id, actor_id, action, target_type, target_id, succeeded, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (actorId) query = query.eq("actor_id", actorId);

  const { data, error } = await query;
  if (error) throw new Error(`감사 로그 조회 실패: ${error.message}`);
  return (data ?? []) as AuditLogRow[];
}
