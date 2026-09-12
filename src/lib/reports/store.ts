import type { SupabaseClient } from "@supabase/supabase-js";
import { OPEN_STATUSES, type ReportCategory, type ReportStatus } from "./policy";

/**
 * [P8-5b] 신고 저장·조회 (FR-013·043·044).
 *
 * `reports`는 RLS를 켜고 정책을 두지 않았다(0010) = **서버 전용**. 신고 내용은
 * 남의 산출물에 대한 고발일 수 있어 브라우저 키로는 한 줄도 읽히면 안 된다.
 *
 * 그래서 **내 것만 보는 조건은 이 모듈이 직접 건다**(`projects/store.ts`와 같은
 * 방식). 관리자용 `listReports`는 반대로 소유자 조건을 걸지 않는다 — 권한은
 * `adminCan`이 판정하고 여기는 그 판정을 지난 뒤에만 닿는다.
 */

const COLUMNS =
  "id, reporter_id, reporter_email, category, body, target_url, target_project_id, status, admin_note, handled_by, handled_at, created_at";

export interface ReportRow {
  id: string;
  reporterId: string | null;
  reporterEmail: string | null;
  category: string;
  body: string;
  targetUrl: string | null;
  targetProjectId: string | null;
  status: string;
  adminNote: string | null;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
}

interface RawRow {
  id: string;
  reporter_id: string | null;
  reporter_email: string | null;
  category: string;
  body: string;
  target_url: string | null;
  target_project_id: string | null;
  status: string;
  admin_note: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
}

const toRow = (row: RawRow): ReportRow => ({
  id: row.id,
  reporterId: row.reporter_id,
  reporterEmail: row.reporter_email,
  category: row.category,
  body: row.body,
  targetUrl: row.target_url,
  targetProjectId: row.target_project_id,
  status: row.status,
  adminNote: row.admin_note,
  handledBy: row.handled_by,
  handledAt: row.handled_at,
  createdAt: row.created_at,
});

/**
 * 신고 주소에서 프로젝트를 짚어낸다.
 *
 * 짚히면 접수함에서 **바로 가릴 수 있다**(FR-016). 못 짚어도 신고는 접수한다 —
 * 주소를 잘못 적었다고 신고를 버리면 정작 급한 고발을 잃는다.
 */
async function resolveTargetProject(
  admin: SupabaseClient,
  targetUrl: string | null,
): Promise<string | null> {
  if (!targetUrl) return null;

  let path: string;
  try {
    path = new URL(targetUrl).pathname;
  } catch {
    return null;
  }

  const match = /^\/site\/([^/]+)/.exec(path);
  if (!match) return null;

  const slug = decodeURIComponent(match[1]);
  const { data } = await admin.from("projects").select("id").eq("slug", slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export interface NewReport {
  reporterId: string;
  reporterEmail: string | null;
  category: ReportCategory;
  body: string;
  targetUrl: string | null;
}

export async function createReport(admin: SupabaseClient, input: NewReport): Promise<ReportRow> {
  const targetProjectId = await resolveTargetProject(admin, input.targetUrl);

  const { data, error } = await admin
    .from("reports")
    .insert({
      reporter_id: input.reporterId,
      // 신고자가 탈퇴해도 누가 신고했는지의 흔적은 남는다.
      reporter_email: input.reporterEmail,
      category: input.category,
      body: input.body,
      target_url: input.targetUrl,
      target_project_id: targetProjectId,
      status: "open",
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`신고 접수 실패: ${error.message}`);
  return toRow(data as RawRow);
}

/** 아직 처리되지 않은 내 신고 수 — 남용 판정에 쓴다. 내용은 받아오지 않는다. */
export async function countOpenReports(admin: SupabaseClient, reporterId: string): Promise<number> {
  const { count, error } = await admin
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("reporter_id", reporterId)
    .in("status", OPEN_STATUSES);

  if (error) throw new Error(`신고 수 조회 실패: ${error.message}`);
  return count ?? 0;
}

/** 내 신고와 그 처리 결과 (FR-044). **소유자 조건을 직접 건다.** */
export async function listMyReports(
  admin: SupabaseClient,
  reporterId: string,
  limit = 50,
): Promise<ReportRow[]> {
  const { data, error } = await admin
    .from("reports")
    .select(COLUMNS)
    .eq("reporter_id", reporterId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`신고 조회 실패: ${error.message}`);
  return ((data ?? []) as RawRow[]).map(toRow);
}

/** 접수함 (FR-043). 관리자는 남의 신고를 봐야 하므로 소유자 조건을 걸지 않는다. */
export async function listReports(
  admin: SupabaseClient,
  { status, limit = 200 }: { status?: ReportStatus; limit?: number },
): Promise<ReportRow[]> {
  let query = admin
    .from("reports")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`접수함 조회 실패: ${error.message}`);
  return ((data ?? []) as RawRow[]).map(toRow);
}

export interface ReportUpdate {
  status: ReportStatus;
  /** 신고한 사람에게 **그대로 보이는 답**이다 (FR-044) — 내부 메모가 아니다. */
  adminNote: string | null;
  handledBy: string;
}

export async function updateReport(
  admin: SupabaseClient,
  reportId: string,
  { status, adminNote, handledBy }: ReportUpdate,
  now: Date = new Date(),
): Promise<ReportRow> {
  // 다시 열면 처리 흔적을 지운다 — 처리한 적 없는 것처럼 보여야 한다
  // (정지 해제에서 사유를 함께 지우는 것과 같은 이유).
  const reopened = status === "open";

  const { data, error } = await admin
    .from("reports")
    .update({
      status,
      admin_note: adminNote,
      handled_by: handledBy,
      handled_at: reopened ? null : now.toISOString(),
    })
    .eq("id", reportId)
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`신고 처리 실패: ${error.message}`);
  return toRow(data as RawRow);
}
