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

/** [P8-7d] 조회 조건 (FR-041). */
export interface AuditQuery {
  actorId?: string;
  action?: string;
  succeeded?: boolean;
  /**
   * 콘솔 열람 기록을 접는다.
   *
   * 실물 8건 중 5건이 "콘솔 열었음"이었다 — 새로고침마다 한 건씩 쌓여
   * 의미 있는 행위를 파묻는다. **지우지는 않는다**(열람도 증거다, Clarify 20).
   */
  hideConsoleOpens?: boolean;
  limit?: number;
}

export interface AuditPage {
  rows: AuditLogRow[];
  /** 접어서 뺀 건수 — 화면이 "몇 건 숨김"이라고 말할 수 있게 */
  hiddenCount: number;
}

/**
 * 기록을 읽어온다 (최신부터).
 *
 * 콘솔 열람 거르기는 **DB가 아니라 여기서** 한다. `detail->>via`로 거르면
 * `detail`이 없는 행(대부분)까지 null 비교에 걸려 조용히 사라진다 —
 * 감사 기록에서 조용히 사라지는 행은 가장 위험한 종류의 버그다.
 * 대신 넉넉히 읽어와서 걸러낸다(지금 규모에서 충분하다).
 */
export async function listAuditLogs(
  admin: SupabaseClient,
  { actorId, action, succeeded, hideConsoleOpens = false, limit = 100 }: AuditQuery = {},
): Promise<AuditPage> {
  // 걸러내고 나면 화면이 텅 비므로 접을 때는 여유를 두고 읽는다.
  const fetchLimit = hideConsoleOpens ? limit * 4 : limit;

  let query = admin
    .from("admin_audit_logs")
    .select("id, actor_id, action, target_type, target_id, succeeded, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (actorId) query = query.eq("actor_id", actorId);
  if (action) query = query.eq("action", action);
  if (succeeded !== undefined) query = query.eq("succeeded", succeeded);

  const { data, error } = await query;
  if (error) throw new Error(`감사 로그 조회 실패: ${error.message}`);

  const all = (data ?? []) as AuditLogRow[];
  if (!hideConsoleOpens) return { rows: all.slice(0, limit), hiddenCount: 0 };

  const kept = all.filter((row) => !(row.action === "developer:read" && row.detail?.via === "/admin"));
  return { rows: kept.slice(0, limit), hiddenCount: all.length - kept.length };
}

/**
 * id 뭉치를 이메일로 바꾼다.
 *
 * 기록에는 UUID만 남는다 — 화면에 `2c8303ba…`를 띄우면 아무도 못 읽는다.
 * 탈퇴해 사라진 사람은 여기 없으므로, 부르는 쪽이 짧은 id로 대신 보여준다.
 */
export async function resolvePeopleEmails(
  admin: SupabaseClient,
  ids: (string | null)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return {};

  const { data, error } = await admin.from("profiles").select("id, email").in("id", unique);
  if (error) throw new Error(`계정 조회 실패: ${error.message}`);

  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; email: string }[]) out[row.id] = row.email;
  return out;
}
