export type Role = "admin" | "developer";

export interface Actor {
  id: string;
  role: Role;
}

/**
 * 소유권 기반 검사가 필요한 행위의 대상. ownerId가 없으면(subject 자체를
 * 안 넘기면) "소유권을 확인할 수 없음"으로 간주해 안전하게 거부한다.
 */
export interface Subject {
  ownerId: string;
}

export type Action =
  | "project:create"
  | "project:read"
  | "project:update"
  | "project:delete"
  | "project:visibility:update"
  | "admin:developers:manage"
  | "admin:usage:view:all";

/** 소유권을 확인해야 하는 행위 — WBS 2.4절 "△ 자기 것" 행 */
const OWNERSHIP_REQUIRED: ReadonlySet<Action> = new Set([
  "project:read",
  "project:update",
  "project:delete",
  "project:visibility:update",
]);

/** 관리자만 쓸 수 있는 행위 — WBS 2.4절 "서버관리자"만 ○ 인 행 */
const ADMIN_ONLY: ReadonlySet<Action> = new Set([
  "admin:developers:manage",
  "admin:usage:view:all",
]);

/**
 * [P2-6] 권한 검사 공통 모듈.
 * WBS `10_SDVC_웹서비스/WBS_서버구축.md` 2.4절 권한 매트릭스를 그대로 코드로 옮긴 것.
 * 화면에서 버튼을 숨기는 것만으로는 막을 수 없으므로, 모든 API 라우트에서
 * 실제 처리 전에 이 함수로 검사한다.
 */
export function can(actor: Actor, action: Action, subject?: Subject): boolean {
  if (actor.role === "admin") {
    return true;
  }

  if (ADMIN_ONLY.has(action)) {
    return false;
  }

  if (action === "project:create") {
    return true;
  }

  if (OWNERSHIP_REQUIRED.has(action)) {
    if (!subject) return false;
    return subject.ownerId === actor.id;
  }

  return false;
}
