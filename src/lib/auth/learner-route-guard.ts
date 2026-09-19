import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  createLearnerGuard,
  type LearnerAccessOptions,
  type LearnerProfile,
} from "@/lib/auth/learner-guard";

interface ProfileRow {
  role: string;
  is_active: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
}

export type LearnerRouteGuardResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

/**
 * Next.js Route Handler에서 쓰는 수강생 접근 관문.
 *
 * 인증 제공자가 검증한 현재 사용자와 관리자 DB 조회를 결합하되, 클라이언트에는
 * 판정에 필요한 최소 오류만 돌려준다. 차단 사유 원문은 T016의 전용 안내 화면
 * 정책이 정하기 전까지 API 응답에 노출하지 않는다.
 */
export async function requireLearnerAccess(
  options?: LearnerAccessOptions,
): Promise<LearnerRouteGuardResult> {
  const supabase = await createClient();
  let authenticatedUser: User | null = null;

  const guard = createLearnerGuard({
    async getAuthenticatedUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      authenticatedUser = user;
      return user ? { id: user.id } : null;
    },
    async loadProfile(userId): Promise<LearnerProfile | null> {
      const admin = createAdminClient();
      const { data, error } = await admin
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
    },
  });

  const result = await guard.requireAccess(options);
  if (!result.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.status },
      ),
    };
  }

  // 순수 가드의 성공은 인증 사용자가 존재함을 보장한다.
  return { ok: true, user: authenticatedUser! };
}
