/**
 * [P6-3] 접근 판정 — "지금 이 요청을 허용하는가".
 *
 * 체험 기간(FR-008), 구독 상태, 월 토큰 한도(FR-026), 프로젝트 수를
 * **서버에서 한 곳에 모아** 판정한다. 브라우저 판정은 우회가 쉬우므로
 * 화면에서는 안내만 하고 실제 차단은 반드시 여기를 거친다.
 *
 * [P2-6]의 `can()`과 같은 원칙: **애매하면 막는다.** 모르는 등급이거나
 * 판단 근거가 없으면 통과시키지 않는다 — 잘못 열어주면 원가가 새고,
 * 잘못 막으면 사용자가 문의할 뿐이다.
 */

export type Grade = "trial" | "basic" | "pro";

export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export interface GradeLimits {
  projects: number;
  monthlyTokens: number;
}

/** 게이트 G2(2026-09-10 확정)에서 정한 값. 바꾸려면 가격 정책부터 다시 본다. */
export const GRADE_LIMITS: Record<Grade, GradeLimits> = {
  trial: { projects: 1, monthlyTokens: 500_000 },
  basic: { projects: 3, monthlyTokens: 2_000_000 },
  pro: { projects: 10, monthlyTokens: 8_000_000 },
};

/** 위 등급을 낮은 것부터. 업그레이드 권유에 쓴다. */
const GRADE_ORDER: Grade[] = ["trial", "basic", "pro"];

export interface AccountState {
  grade: Grade;
  subscriptionStatus: SubscriptionStatus;
  /** 체험 만료 시각(ISO). 없으면 판단 근거가 없다고 보고 막는다 */
  trialEndsAt: string | null;
  monthlyTokensUsed: number;
  projectCount: number;
}

export type DenyReason =
  | "trial_expired"
  | "subscription_inactive"
  | "token_limit"
  | "project_limit"
  | "unknown_grade";

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: DenyReason; message: string; upgradeTo?: Grade };

const ALLOW: Decision = { allowed: true };

function deny(reason: DenyReason, message: string, upgradeTo?: Grade): Decision {
  return upgradeTo ? { allowed: false, reason, message, upgradeTo } : { allowed: false, reason, message };
}

/** 이 등급보다 위 등급이 있으면 그것. 최고 등급이면 undefined. */
function nextGrade(grade: Grade): Grade | undefined {
  return GRADE_ORDER[GRADE_ORDER.indexOf(grade) + 1];
}

/** 대화를 시작(또는 계속)해도 되는가. */
export function canStartChat(state: AccountState, now: Date = new Date()): Decision {
  const limits = GRADE_LIMITS[state.grade];
  if (!limits) {
    return deny("unknown_grade", "등급 정보를 확인할 수 없습니다. 관리자에게 문의해주세요.");
  }

  const paying = state.subscriptionStatus === "active";

  if (!paying) {
    if (state.subscriptionStatus === "past_due" || state.subscriptionStatus === "canceled") {
      return deny(
        "subscription_inactive",
        state.subscriptionStatus === "past_due"
          ? "결제가 밀려 있어요. 결제 정보를 확인하면 바로 다시 쓸 수 있습니다."
          : "구독이 해지된 상태예요. 다시 구독하면 이어서 쓸 수 있습니다.",
      );
    }

    // 아직 결제 전 — 체험 기간 안인지 본다.
    if (!state.trialEndsAt) {
      return deny("trial_expired", "체험 기간 정보를 확인할 수 없습니다. 관리자에게 문의해주세요.");
    }
    if (new Date(state.trialEndsAt).getTime() <= now.getTime()) {
      return deny(
        "trial_expired",
        "7일 체험 기간이 끝났어요. 계속 쓰시려면 요금제를 선택해주세요.",
        nextGrade("trial"),
      );
    }
  }

  if (state.monthlyTokensUsed >= limits.monthlyTokens) {
    const upgrade = nextGrade(state.grade);
    return deny(
      "token_limit",
      upgrade
        ? "이번 달 사용량을 다 쓰셨어요. 다음 달에 초기화되고, 지금 바로 쓰시려면 상위 요금제로 올릴 수 있습니다."
        : "이번 달 사용량을 다 쓰셨어요. 다음 달에 초기화됩니다.",
      upgrade,
    );
  }

  return ALLOW;
}

/** 새 프로젝트를 만들어도 되는가. 대화가 막힌 상태면 당연히 못 만든다. */
export function canCreateProject(state: AccountState, now: Date = new Date()): Decision {
  const chat = canStartChat(state, now);
  if (!chat.allowed) return chat;

  const limits = GRADE_LIMITS[state.grade];
  if (state.projectCount >= limits.projects) {
    const upgrade = nextGrade(state.grade);
    return deny(
      "project_limit",
      `지금 등급에서는 프로젝트를 ${limits.projects}개까지 만들 수 있어요. ` +
        (upgrade
          ? "안 쓰는 프로젝트를 지우거나 요금제를 올려주세요."
          : "안 쓰는 프로젝트를 지우고 다시 시도해주세요."),
      upgrade,
    );
  }

  return ALLOW;
}
