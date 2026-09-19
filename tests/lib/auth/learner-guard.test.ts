import { describe, expect, it, vi } from "vitest";

/**
 * [T013] 수강생 보호 API의 공통 접근 경계 (FR-020·022·024, SC-007·012·013).
 *
 * Next.js Route Handler는 공개 API와 같은 보안 경계를 가진다. 화면에서 버튼을
 * 숨기거나 로그인 쿠키가 있다는 사실만으로 허용하지 않고, 매 요청마다 서버가
 * 현재 프로필의 역할·차단 상태와 대상 소유권을 다시 확인해야 한다.
 *
 * 이 테스트는 아직 없는 공통 가드의 계약을 먼저 고정한다. T014가 상태 스키마를
 * 준비하고 T015가 이 계약을 구현해 모든 보호 API에 연결한다.
 */

interface Profile {
  role: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

const activeLearner: Profile = {
  role: "developer",
  suspendedAt: null,
  suspendedReason: null,
};

function dependencies(overrides: Partial<{
  user: { id: string } | null;
  profile: Profile | null;
}> = {}) {
  const user = overrides.user === undefined ? { id: "learner-1" } : overrides.user;
  const profile = overrides.profile === undefined ? activeLearner : overrides.profile;

  return {
    getAuthenticatedUser: vi.fn().mockResolvedValue(user),
    loadProfile: vi.fn().mockResolvedValue(profile),
  };
}

async function createGuard(deps: ReturnType<typeof dependencies>) {
  const guardModule = await import("@/lib/auth/learner-guard");
  return guardModule.createLearnerGuard(deps);
}

describe("[T013] 수강생 공통 접근 경계 - RED", () => {
  it("인증되지 않은 요청은 401이고 프로필이나 소유권을 조회하지 않는다", async () => {
    const deps = dependencies({ user: null });
    const guard = await createGuard(deps);

    const result = await guard.requireAccess({ ownerId: "learner-1" });

    expect(result).toMatchObject({ ok: false, status: 401, code: "unauthenticated" });
    expect(deps.loadProfile).not.toHaveBeenCalled();
  });

  it("활성 수강생은 자신의 보호 자원에 접근할 수 있다", async () => {
    const deps = dependencies();
    const guard = await createGuard(deps);

    const result = await guard.requireAccess({ ownerId: "learner-1" });

    expect(result).toEqual({
      ok: true,
      actor: { id: "learner-1", role: "developer" },
    });
  });

  it("다른 수강생의 자원은 존재 여부를 숨기며 404로 거부한다", async () => {
    const deps = dependencies();
    const guard = await createGuard(deps);

    const result = await guard.requireAccess({ ownerId: "learner-2" });

    expect(result).toMatchObject({ ok: false, status: 404, code: "not_found" });
  });

  it("기존 로그인 세션이 남아 있어도 현재 계정이 차단됐으면 403으로 거부한다", async () => {
    const deps = dependencies({
      profile: {
        ...activeLearner,
        suspendedAt: "2026-09-20T00:00:00.000Z",
        suspendedReason: "반복적인 정책 위반",
      },
    });
    const guard = await createGuard(deps);

    const result = await guard.requireAccess({ ownerId: "learner-1" });

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "account_suspended",
    });
  });

  it("차단 사용자가 화면을 거치지 않고 직접 API를 호출해도 같은 경계가 막는다", async () => {
    const deps = dependencies({
      profile: {
        ...activeLearner,
        suspendedAt: "2026-09-20T00:00:00.000Z",
        suspendedReason: "자동화된 악성 호출",
      },
    });
    const guard = await createGuard(deps);

    const result = await guard.requireAccess({ ownerId: "learner-1" });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 403, code: "account_suspended" });
  });

  it("오래된 세션 상태를 캐시하지 않고 매 요청마다 최신 프로필을 다시 읽는다", async () => {
    const deps = dependencies();
    deps.loadProfile
      .mockResolvedValueOnce(activeLearner)
      .mockResolvedValueOnce({
        ...activeLearner,
        suspendedAt: "2026-09-20T00:00:00.000Z",
        suspendedReason: "첫 요청 직후 차단",
      });
    const guard = await createGuard(deps);

    expect(await guard.requireAccess()).toMatchObject({ ok: true });
    expect(await guard.requireAccess()).toMatchObject({
      ok: false,
      status: 403,
      code: "account_suspended",
    });
    expect(deps.loadProfile).toHaveBeenCalledTimes(2);
  });

  it("프로필 누락이나 알 수 없는 역할은 안전하게 거부한다", async () => {
    for (const profile of [null, { ...activeLearner, role: "unknown" }]) {
      const deps = dependencies({ profile });
      const guard = await createGuard(deps);

      const result = await guard.requireAccess();

      expect(result).toMatchObject({
        ok: false,
        status: 403,
        code: "account_unavailable",
      });
    }
  });
});
