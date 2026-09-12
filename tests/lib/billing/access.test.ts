import { describe, expect, it } from "vitest";
import {
  canStartChat,
  canCreateProject,
  GRADE_LIMITS,
  type AccountState,
} from "@/lib/billing/access";

/**
 * [P6-3] "지금 이 요청을 허용하는가" — 서버가 판정한다 (FR-008·FR-026).
 *
 * 브라우저에서 판정하면 우회가 쉬우므로 반드시 서버에서 한다.
 * [P2-6] `can()`과 같은 원칙: **애매하면 막는다.**
 */

const NOW = new Date("2026-09-11T00:00:00Z");
const TOMORROW = "2026-09-12T00:00:00Z";
const YESTERDAY = "2026-09-10T00:00:00Z";

function state(overrides: Partial<AccountState> = {}): AccountState {
  return {
    grade: "trial",
    subscriptionStatus: "none",
    trialEndsAt: TOMORROW,
    monthlyTokensUsed: 0,
    projectCount: 0,
    ...overrides,
  };
}

describe("[P6-3] 등급별 한도", () => {
  it("게이트 G2에서 정한 값을 그대로 쓴다", () => {
    expect(GRADE_LIMITS.trial).toEqual({ projects: 1, monthlyTokens: 500_000 });
    expect(GRADE_LIMITS.basic).toEqual({ projects: 3, monthlyTokens: 2_000_000 });
    expect(GRADE_LIMITS.pro).toEqual({ projects: 10, monthlyTokens: 8_000_000 });
  });
});

describe("[P6-3] canStartChat", () => {
  it("체험 기간 안이면 허용한다", () => {
    expect(canStartChat(state(), NOW)).toEqual({ allowed: true });
  });

  it("체험이 지났고 결제도 안 했으면 막는다 (FR-008)", () => {
    const decision = canStartChat(state({ trialEndsAt: YESTERDAY }), NOW);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("trial_expired");
    expect(decision.message).toMatch(/체험/);
  });

  it("결제한 구독자는 체험 만료와 무관하게 허용한다", () => {
    const paid = state({
      grade: "basic",
      subscriptionStatus: "active",
      trialEndsAt: YESTERDAY,
    });
    expect(canStartChat(paid, NOW)).toEqual({ allowed: true });
  });

  it("미납·해지 상태는 막는다", () => {
    for (const status of ["past_due", "canceled"] as const) {
      const decision = canStartChat(
        state({ grade: "basic", subscriptionStatus: status, trialEndsAt: YESTERDAY }),
        NOW,
      );
      expect(decision.allowed, status).toBe(false);
      if (decision.allowed) throw new Error("unreachable");
      expect(decision.reason).toBe("subscription_inactive");
    }
  });

  it("이번 달 토큰 한도를 다 쓰면 막고 업그레이드를 권한다 (FR-026)", () => {
    const decision = canStartChat(
      state({
        grade: "basic",
        subscriptionStatus: "active",
        monthlyTokensUsed: GRADE_LIMITS.basic.monthlyTokens,
      }),
      NOW,
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("token_limit");
    expect(decision.upgradeTo).toBe("pro");
  });

  it("최고 등급이 한도를 넘기면 업그레이드 권유는 하지 않는다", () => {
    const decision = canStartChat(
      state({
        grade: "pro",
        subscriptionStatus: "active",
        monthlyTokensUsed: GRADE_LIMITS.pro.monthlyTokens + 1,
      }),
      NOW,
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.upgradeTo).toBeUndefined();
  });

  it("한도 직전까지는 허용한다 (경계값)", () => {
    const almost = state({
      grade: "basic",
      subscriptionStatus: "active",
      monthlyTokensUsed: GRADE_LIMITS.basic.monthlyTokens - 1,
    });
    expect(canStartChat(almost, NOW)).toEqual({ allowed: true });
  });

  it("프로젝트 수가 꽉 차도 대화 자체는 막지 않는다", () => {
    const full = state({ projectCount: 99 });
    expect(canStartChat(full, NOW)).toEqual({ allowed: true });
  });

  it("모르는 등급이면 막는다 (fail-closed)", () => {
    const weird = state({ grade: "platinum" as never, subscriptionStatus: "active" });
    expect(canStartChat(weird, NOW).allowed).toBe(false);
  });

  it("체험 만료일이 없으면 막는다 (판단할 근거가 없으므로)", () => {
    expect(canStartChat(state({ trialEndsAt: null }), NOW).allowed).toBe(false);
  });
});

describe("[P6-3] canCreateProject", () => {
  it("한도 안이면 허용한다", () => {
    expect(canCreateProject(state(), NOW)).toEqual({ allowed: true });
  });

  it("등급별 프로젝트 수를 넘기면 막고 업그레이드를 권한다", () => {
    const decision = canCreateProject(state({ projectCount: 1 }), NOW);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("project_limit");
    expect(decision.message).toMatch(/1개/);
    expect(decision.upgradeTo).toBe("basic");
  });

  it("대화를 못 하는 상태면 프로젝트도 못 만든다", () => {
    const expired = state({ trialEndsAt: YESTERDAY });
    expect(canCreateProject(expired, NOW).allowed).toBe(false);
  });
});

/**
 * [P8-6] 정지된 계정 (FR-014).
 *
 * **로그인은 되되 모두 차단**한다(Clarify 19) — 들어와서 왜 정지됐는지 보고
 * 문의할 수 있어야 한다. 돈 낸 사람을 설명 없이 문 밖으로 밀어내지 않는다.
 */
describe("[P8-6] 정지된 계정", () => {
  const paying: AccountState = {
    grade: "pro",
    subscriptionStatus: "active",
    trialEndsAt: null,
    monthlyTokensUsed: 0,
    projectCount: 0,
  };

  it("돈을 내고 있어도 정지되면 막힌다", () => {
    const decision = canStartChat({ ...paying, suspendedAt: "2026-09-12T00:00:00.000Z" });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("suspended");
  });

  it("정지 안내에는 왜 막혔는지가 들어간다", () => {
    const decision = canStartChat({ ...paying, suspendedAt: "2026-09-12T00:00:00.000Z" });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.message).toMatch(/정지|문의/);
  });

  it("정지된 사람은 프로젝트도 못 만든다", () => {
    const decision = canCreateProject({ ...paying, suspendedAt: "2026-09-12T00:00:00.000Z" });

    expect(decision.allowed).toBe(false);
  });

  it("정지가 풀리면 원래대로다", () => {
    expect(canStartChat({ ...paying, suspendedAt: null }).allowed).toBe(true);
  });
});

/**
 * [P8-2b][P8-4a] 교육용 운영 — 부여한 등급과 계정별 한도 (FR-035·036).
 *
 * 실효 등급 순서가 핵심이다. 섞이면 **"결제했는데 강등"** 이나
 * **"공짜로 프로"** 가 생긴다.
 */
describe("[P8-2b] 부여한 등급", () => {
  const expiredTrial: AccountState = {
    grade: "trial",
    subscriptionStatus: "none",
    trialEndsAt: "2026-09-01T00:00:00.000Z", // 이미 지남
    monthlyTokensUsed: 0,
    projectCount: 0,
  };
  const NOW = new Date("2026-09-12T00:00:00.000Z");

  it("체험이 끝났어도 부여가 살아 있으면 쓸 수 있다", () => {
    const decision = canStartChat(
      { ...expiredTrial, grantedGrade: "basic", grantedUntil: "2026-12-31T00:00:00.000Z" },
      NOW,
    );

    expect(decision.allowed).toBe(true);
  });

  it("부여가 만료되면 즉시 다시 막힌다 (정리 작업을 기다리지 않는다)", () => {
    const decision = canStartChat(
      { ...expiredTrial, grantedGrade: "pro", grantedUntil: "2026-09-11T00:00:00.000Z" },
      NOW,
    );

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("trial_expired");
  });

  it("만료일이 없는 부여는 계속 유효하다", () => {
    const decision = canStartChat(
      { ...expiredTrial, grantedGrade: "basic", grantedUntil: null },
      NOW,
    );

    expect(decision.allowed).toBe(true);
  });

  it("부여받으면 그 등급의 한도를 쓴다", () => {
    // 체험 한도(50만)를 넘었지만 기본(200만) 한도 안이다
    const decision = canStartChat(
      {
        ...expiredTrial,
        monthlyTokensUsed: 900_000,
        grantedGrade: "basic",
        grantedUntil: "2026-12-31T00:00:00.000Z",
      },
      NOW,
    );

    expect(decision.allowed).toBe(true);
  });

  it("정지가 부여보다 세다", () => {
    const decision = canStartChat(
      {
        ...expiredTrial,
        grantedGrade: "pro",
        grantedUntil: "2026-12-31T00:00:00.000Z",
        suspendedAt: "2026-09-12T00:00:00.000Z",
      },
      NOW,
    );

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("suspended");
  });

  it("결제한 사람은 부여 때문에 강등되지 않는다", () => {
    // 프로를 결제 중인데 기본을 부여받았다 — 결제한 쪽이 이겨야 한다
    const decision = canStartChat(
      {
        grade: "pro",
        subscriptionStatus: "active",
        trialEndsAt: null,
        monthlyTokensUsed: 3_000_000, // 기본(200만) 초과, 프로(800만) 이내
        projectCount: 0,
        grantedGrade: "basic",
        grantedUntil: "2026-12-31T00:00:00.000Z",
      },
      NOW,
    );

    expect(decision.allowed).toBe(true);
  });

  it("부여받은 사람도 프로젝트 수는 그 등급 기준이다", () => {
    const decision = canCreateProject(
      {
        ...expiredTrial,
        projectCount: 2, // 체험은 1개, 기본은 3개
        grantedGrade: "basic",
        grantedUntil: "2026-12-31T00:00:00.000Z",
      },
      NOW,
    );

    expect(decision.allowed).toBe(true);
  });
});

describe("[P8-4a] 계정별 한도", () => {
  const base: AccountState = {
    grade: "basic",
    subscriptionStatus: "active",
    trialEndsAt: null,
    monthlyTokensUsed: 500_000,
    projectCount: 0,
  };

  it("지정하면 등급 기본값 대신 그 값을 쓴다", () => {
    // 기본 등급은 200만이지만 30만으로 조였다
    const decision = canStartChat({ ...base, monthlyTokenLimit: 300_000 });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("token_limit");
  });

  it("지정한 값이 등급보다 넉넉해도 그 값을 쓴다", () => {
    const decision = canStartChat({ ...base, monthlyTokensUsed: 5_000_000, monthlyTokenLimit: 9_000_000 });

    expect(decision.allowed).toBe(true);
  });

  it("**0이면 완전히 막는다** — null과 다르다", () => {
    const decision = canStartChat({ ...base, monthlyTokensUsed: 0, monthlyTokenLimit: 0 });

    expect(decision.allowed).toBe(false);
  });

  it("비워두면(null) 등급 기본값을 쓴다", () => {
    const decision = canStartChat({ ...base, monthlyTokenLimit: null });

    expect(decision.allowed).toBe(true);
  });
});
