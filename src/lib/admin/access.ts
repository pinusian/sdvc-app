/**
 * [P8-1a] 관리자 권한 판정 (FR-034).
 *
 * **판정을 여기 한 곳에만 둔다.** 관리자 기능마다 제각각 검사하면 나중에
 * 등급을 나눌 때 전부 되돌아가 고쳐야 하고, 권한을 되돌아가 고치는 자리에서
 * 구멍이 생긴다 — [P2-7]에서 RLS 자기수정 허점을 그렇게 만들었다.
 *
 * [P2-6] `can()`과 같은 원칙: **애매하면 막는다.** 모르는 등급이거나
 * 모르는 행위면 통과시키지 않는다.
 *
 * 지금 관리자는 한 사람뿐이라 등급을 고르는 **화면은 없다**. 그래도 판정만
 * 미리 갈라두면, 나중에 사람을 쓸 때 이 파일 하나만 고치면 된다.
 */

export type AdminTier = "super" | "operator" | "support";

/** 관리자가 할 수 있는 일. 새 기능을 만들면 **여기 먼저** 추가하게 된다. */
export const ADMIN_ACTIONS = [
  "developer:read",
  "developer:suspend",
  "developer:extend_trial",
  "artifact:block",
  "usage:read",
  "audit:read",
  "policy:change",
  "report:read",
  "report:handle",
  /** [P8-13] 유지보수 목적으로 남의 프로젝트를 열람한다 (FR-046). 감사 로그와 같은 민감도라 최고관리자만 준다. */
  "project:view_any",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export interface AdminActor {
  /** profiles.role — 관리자가 아니면 등급이 무엇이든 소용없다 */
  role: string;
  adminTier: AdminTier | null;
  /** 정지된 관리자는 아무것도 못 한다 */
  suspendedAt?: string | null;
}

/**
 * 등급별로 할 수 있는 일.
 * - super    : 전권
 * - operator : 사용자관리·차단은 되고 **정책 변경은 안 된다**
 * - support  : 읽기 전용
 *
 * 감사 로그(`audit:read`)는 최고관리자만 본다 — 누가 무엇을 보았는지의 기록
 * 자체가 민감하다.
 */
const ALLOWED: Record<AdminTier, readonly AdminAction[]> = {
  super: ADMIN_ACTIONS,
  operator: [
    "developer:read",
    "developer:suspend",
    "developer:extend_trial",
    "artifact:block",
    "usage:read",
    "report:read",
    "report:handle",
  ],
  // 읽기 전용 — 남의 신고를 마음대로 닫지 못한다.
  support: ["developer:read", "usage:read", "report:read"],
};

export function adminCan(actor: AdminActor, action: AdminAction): boolean {
  // 관리자가 아니면 끝. `profiles.admin_tier`는 기본값이 super라서,
  // role을 보지 않으면 모든 개발자가 전권을 갖게 된다.
  if (actor.role !== "admin") return false;

  // 정지된 관리자는 자기 정지를 풀 수도 없어야 한다.
  if (actor.suspendedAt) return false;

  const tier = actor.adminTier;
  if (!tier || !(tier in ALLOWED)) return false;

  if (!(ADMIN_ACTIONS as readonly string[]).includes(action)) return false;

  return ALLOWED[tier].includes(action);
}
