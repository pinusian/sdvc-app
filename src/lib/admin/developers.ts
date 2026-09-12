import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * [P8-2] 개발자 관리 (FR-014).
 *
 * **소유자 조건을 걸지 않는다** — 관리자는 남의 계정을 다뤄야 하기 때문이다.
 * 그래서 이 모듈은 관리자 라우트에서만 부른다. 권한 판정은 라우트가
 * `adminCan`으로 하고, 여기는 그 판정을 통과한 뒤에만 닿는다.
 *
 * (비교: `projects/store.ts`는 정반대로 매번 `owner_id` 조건을 직접 건다.)
 */

/** 체험 연장 단위. 처음 주는 기간과 같게 둔다. */
export const TRIAL_EXTENSION_DAYS = 7;

export interface DeveloperRow {
  id: string;
  email: string;
  role: string;
  grade: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
}

interface RawRow {
  id: string;
  email: string;
  role: string;
  grade: string;
  subscription_status: string;
  trial_ends_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
}

const COLUMNS =
  "id, email, role, grade, subscription_status, trial_ends_at, suspended_at, suspended_reason, created_at";

/** 개발자 목록. 한 화면에서 보는 것이 목표이므로(SC-006) 필요한 것만 고른다. */
export async function listDevelopers(
  admin: SupabaseClient,
  { search, limit = 200 }: { search?: string; limit?: number } = {},
): Promise<DeveloperRow[]> {
  let query = admin
    .from("profiles")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (search) query = query.ilike("email", `%${search}%`);

  const { data, error } = await query;
  if (error) throw new Error(`개발자 목록 조회 실패: ${error.message}`);

  return ((data ?? []) as RawRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    grade: row.grade,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
    createdAt: row.created_at,
  }));
}

/**
 * 계정 정지/해제 (FR-014).
 *
 * 해제할 때는 **사유도 함께 지운다** — 사유만 남아 있으면 화면에서
 * 정지된 것처럼 보인다.
 */
export async function setSuspended(
  admin: SupabaseClient,
  userId: string,
  suspended: boolean,
  reason: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({
      suspended_at: suspended ? now.toISOString() : null,
      suspended_reason: suspended ? reason : null,
    })
    .eq("id", userId)
    .select("id")
    .single();

  if (error) throw new Error(`${suspended ? "정지" : "정지 해제"} 실패: ${error.message}`);
}

/**
 * 체험 연장 (FR-014).
 *
 * **이미 지난 체험은 오늘부터 다시 센다.** 과거 날짜에 7일을 더하면
 * 여전히 만료 상태라, 연장을 눌러도 아무 일이 없는 것처럼 보인다.
 */
export async function extendTrial(
  admin: SupabaseClient,
  userId: string,
  currentTrialEndsAt: string | null,
  now: Date = new Date(),
): Promise<string> {
  const current = currentTrialEndsAt ? new Date(currentTrialEndsAt) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  const next = new Date(base.getTime() + TRIAL_EXTENSION_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await admin
    .from("profiles")
    .update({ trial_ends_at: next.toISOString() })
    .eq("id", userId)
    .select("id")
    .single();

  if (error) throw new Error(`체험 연장 실패: ${error.message}`);
  return next.toISOString();
}
