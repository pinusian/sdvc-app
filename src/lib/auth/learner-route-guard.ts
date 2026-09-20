import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  createLearnerGuard,
  type LearnerAccessOptions,
  type LearnerAccessResult,
} from "@/lib/auth/learner-guard";
import { loadLearnerProfile } from "@/lib/auth/learner-profile";

type LearnerAccessDenied = Exclude<LearnerAccessResult, { ok: true }>;

export type LearnerRouteGuardResult =
  | { ok: true; user: User }
  | {
      ok: false;
      status: LearnerAccessDenied["status"];
      code: LearnerAccessDenied["code"];
      response: NextResponse;
    };

/**
 * Next.js Route Handler에서 쓰는 수강생 접근 관문.
 *
 * 인증 제공자가 검증한 현재 사용자와 관리자 DB 조회를 결합하되, 클라이언트에는
 * 판정에 필요한 최소 오류만 돌려준다. 차단 사유 원문은 API 응답에 노출하지
 * 않고, 인증된 본인의 T016 전용 안내 화면에서만 별도로 읽는다.
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
    loadProfile: loadLearnerProfile,
  });

  const result = await guard.requireAccess(options);
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      code: result.code,
      response: NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.status },
      ),
    };
  }

  // 순수 가드의 성공은 인증 사용자가 존재함을 보장한다.
  return { ok: true, user: authenticatedUser! };
}
