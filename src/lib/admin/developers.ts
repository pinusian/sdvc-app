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
  /** [P8-2b] 결제 없이 부여한 등급 (FR-035) */
  grantedGrade: string | null;
  grantedUntil: string | null;
  grantedReason: string | null;
  /** [P8-4a] 계정별 월 한도. null이면 등급 기본값 (FR-036) */
  monthlyTokenLimit: number | null;
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
  granted_grade: string | null;
  granted_until: string | null;
  granted_reason: string | null;
  monthly_token_limit: number | null;
}

const COLUMNS =
  "id, email, role, grade, subscription_status, trial_ends_at, suspended_at, suspended_reason, created_at, granted_grade, granted_until, granted_reason, monthly_token_limit";

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
    grantedGrade: row.granted_grade,
    grantedUntil: row.granted_until,
    grantedReason: row.granted_reason,
    // 0을 null로 바꾸지 않는다 — 0은 완전 차단이다.
    monthlyTokenLimit: row.monthly_token_limit,
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
  actorId: string | null = null,
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({
      suspended_at: suspended ? now.toISOString() : null,
      suspended_reason: suspended ? reason : null,
      is_active: !suspended,
      suspended_by: suspended ? actorId : null,
      access_state_changed_at: now.toISOString(),
    })
    .eq("id", userId)
    .select("id")
    .single();

  if (error) throw new Error(`${suspended ? "정지" : "정지 해제"} 실패: ${error.message}`);
}

export async function getLearnerAccessState(
  admin: SupabaseClient,
  userId: string,
): Promise<"active" | "suspended"> {
  const { data, error } = await admin
    .from("profiles")
    .select("is_active, suspended_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`수강생 상태 조회 실패: ${error.message}`);
  if (!data) throw new Error("수강생을 찾을 수 없습니다.");
  return data.is_active && !data.suspended_at ? "active" : "suspended";
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

/** [P8-2b] 부여할 등급. 결제 등급(`grade`)과 섞지 않는다 (FR-035). */
export interface GrantInput {
  grade: "basic" | "pro";
  /** 언제까지. 비우면 무기한 */
  until?: string | null;
  reason?: string | null;
}

/**
 * 등급 부여 / 해제 (FR-035).
 *
 * 해제할 때는 **세 값을 모두 지운다** — 사유만 남으면 화면에서 아직 준 것처럼 보인다
 * (정지 해제에서 사유를 함께 지우는 것과 같은 이유).
 */
export async function grantGrade(
  admin: SupabaseClient,
  userId: string,
  grant: GrantInput | null,
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({
      granted_grade: grant?.grade ?? null,
      granted_until: grant?.until ?? null,
      granted_reason: grant?.reason ?? null,
    })
    .eq("id", userId)
    .select("id")
    .single();

  if (error) throw new Error(`${grant ? "등급 부여" : "부여 해제"} 실패: ${error.message}`);
}

/**
 * [P8-4a] 계정별 월 한도 (FR-036).
 *
 * `null`이면 등급 기본값으로 되돌린다. **`0`은 완전 차단**이며 `null`과 다르다.
 * 음수는 DB 제약에 닿기 전에 여기서 막는다 — 화면에 뜨는 말이 더 친절하다.
 */
export async function setMonthlyLimit(
  admin: SupabaseClient,
  userId: string,
  limit: number | null,
): Promise<void> {
  if (limit != null && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error("월 한도는 0 이상의 정수여야 합니다.");
  }

  const { error } = await admin
    .from("profiles")
    .update({ monthly_token_limit: limit })
    .eq("id", userId)
    .select("id")
    .single();

  if (error) throw new Error(`월 한도 변경 실패: ${error.message}`);
}
