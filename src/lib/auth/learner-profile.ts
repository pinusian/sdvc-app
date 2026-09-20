import { createAdminClient } from "@/lib/supabase/server";
import type { LearnerProfile } from "@/lib/auth/learner-guard";

interface ProfileRow {
  role: string;
  is_active: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
}

/** 서버에서 최신 수강생 상태를 읽는 단일 경로. */
export async function loadLearnerProfile(userId: string): Promise<LearnerProfile | null> {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("role, is_active, suspended_at, suspended_reason")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as ProfileRow;
  return {
    role: row.role,
    isActive: row.is_active,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
  };
}
