/**
 * 수강생 보호 자원의 공통 판정 규칙.
 *
 * 세션에 들어 있던 역할이나 차단 상태를 신뢰하지 않는다. 호출할 때마다
 * `loadProfile`을 다시 실행해 오래된 세션과 직접 API 호출도 같은 경계에서
 * 막는다. DB의 `developer` 역할은 제품 화면의 수강생을 뜻한다.
 */

export interface LearnerIdentity {
  id: string;
}

export interface LearnerProfile {
  role: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

export interface LearnerGuardDependencies {
  getAuthenticatedUser(): Promise<LearnerIdentity | null>;
  loadProfile(userId: string): Promise<LearnerProfile | null>;
}

export interface LearnerAccessOptions {
  ownerId?: string;
}

export type LearnerAccessResult =
  | { ok: true; actor: { id: string; role: "developer" } }
  | {
      ok: false;
      status: 401 | 403 | 404;
      code:
        | "unauthenticated"
        | "account_inactive"
        | "account_suspended"
        | "account_unavailable"
        | "not_found";
      message: string;
    };

export interface LearnerGuard {
  requireAccess(options?: LearnerAccessOptions): Promise<LearnerAccessResult>;
}

function denied(
  status: 401 | 403 | 404,
  code: Exclude<LearnerAccessResult, { ok: true }>["code"],
  message: string,
): LearnerAccessResult {
  return { ok: false, status, code, message };
}

export function createLearnerGuard(deps: LearnerGuardDependencies): LearnerGuard {
  return {
    async requireAccess(options = {}): Promise<LearnerAccessResult> {
      const user = await deps.getAuthenticatedUser();
      if (!user) {
        return denied(401, "unauthenticated", "로그인이 필요합니다.");
      }

      // 매 호출마다 다시 읽는다. 세션 생성 뒤 차단된 계정도 다음 요청부터 막힌다.
      const profile = await deps.loadProfile(user.id);
      if (!profile || profile.role !== "developer") {
        return denied(403, "account_unavailable", "계정 정보를 확인할 수 없습니다.");
      }

      if (profile.suspendedAt) {
        return denied(403, "account_suspended", "계정 이용이 제한되었습니다.");
      }

      if (!profile.isActive) {
        return denied(403, "account_inactive", "비활성화된 계정입니다.");
      }

      if (options.ownerId !== undefined && options.ownerId !== user.id) {
        return denied(404, "not_found", "찾을 수 없습니다.");
      }

      return { ok: true, actor: { id: user.id, role: "developer" } };
    },
  };
}
