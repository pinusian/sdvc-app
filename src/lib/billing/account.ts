import type { SupabaseClient } from "@supabase/supabase-js";
import { monthlyTokenUsage } from "@/lib/usage/store";
import type { AccountState, Grade, SubscriptionStatus } from "@/lib/billing/access";

/**
 * [P6-4] 판정에 필요한 계정 상태를 한 번에 모은다.
 *
 * 프로필(등급·구독상태·체험만료) + 이번 달 사용량 + 프로젝트 수.
 * 프로필이 없으면 **판단할 근거가 없으므로 null**을 주고, 부르는 쪽이 막는다.
 */

/** 세지 못했을 때 쓰는 값 — 0으로 치면 한도가 무력화되므로 막히는 쪽으로 둔다. */
const UNCOUNTABLE = Number.MAX_SAFE_INTEGER;

interface ProfileRow {
  grade: Grade;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  /** [P8-6] 계정 정지 (FR-014) */
  suspended_at: string | null;
  /** [P8-2b] 결제 없이 부여한 등급 (FR-035) */
  granted_grade: Grade | null;
  granted_until: string | null;
  /** [P8-4a] 계정별 월 한도 (FR-036). 0도 유효한 값이다 */
  monthly_token_limit: number | null;
}

export async function loadAccountState(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<AccountState | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select(
      "grade, subscription_status, trial_ends_at, suspended_at, granted_grade, granted_until, monthly_token_limit",
    )
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;

  const row = profile as ProfileRow;
  const [monthlyTokensUsed, projectCount] = await Promise.all([
    monthlyTokenUsage(admin, userId, now),
    countProjects(admin, userId),
  ]);

  return {
    grade: row.grade,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    suspendedAt: row.suspended_at,
    grantedGrade: row.granted_grade,
    grantedUntil: row.granted_until,
    // `?? null`로 쓰면 0이 null이 되어 "완전 차단"이 "기본값"으로 바뀐다.
    monthlyTokenLimit: row.monthly_token_limit,
    monthlyTokensUsed,
    projectCount,
  };
}

async function countProjects(admin: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);

  // 셀 수 없으면 한도를 넘긴 것으로 본다 (안전한 쪽으로 틀린다).
  if (error || count === null || count === undefined) return UNCOUNTABLE;
  return count;
}
