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
