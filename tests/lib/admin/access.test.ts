import { describe, expect, it } from "vitest";
import { adminCan, ADMIN_ACTIONS, type AdminActor } from "@/lib/admin/access";

/**
 * [P8-1a] 관리자 권한 판정 (FR-034).
 *
 * **판정을 여기 한 곳에만 둔다.** 관리자 기능마다 제각각 검사하면, 나중에
 * 등급을 나눌 때 전부 되돌아가 고쳐야 하고 그 자리에서 구멍이 생긴다
 * ([P2-7]에서 RLS 자기수정 허점을 그렇게 만들었다).
 *
 * [P2-6] `can()`과 같은 원칙: **애매하면 막는다.**
 */

const actor = (over: Partial<AdminActor> = {}): AdminActor => ({
  role: "admin",
  adminTier: "super",
  suspendedAt: null,
  ...over,
});

describe("[P8-1a] adminCan", () => {
  it("최고관리자는 전부 할 수 있다", () => {
    for (const action of ADMIN_ACTIONS) {
      expect(adminCan(actor(), action), action).toBe(true);
    }
  });

  it("운영자는 사용자관리·차단은 되고 정책변경은 안 된다", () => {
    const operator = actor({ adminTier: "operator" });

    expect(adminCan(operator, "developer:read")).toBe(true);
    expect(adminCan(operator, "developer:suspend")).toBe(true);
    expect(adminCan(operator, "developer:extend_trial")).toBe(true);
    expect(adminCan(operator, "artifact:block")).toBe(true);
    expect(adminCan(operator, "usage:read")).toBe(true);
    expect(adminCan(operator, "policy:change")).toBe(false);
  });

  it("지원은 읽기만 된다", () => {
    const support = actor({ adminTier: "support" });

    expect(adminCan(support, "developer:read")).toBe(true);
    expect(adminCan(support, "usage:read")).toBe(true);
    expect(adminCan(support, "developer:suspend")).toBe(false);
    expect(adminCan(support, "artifact:block")).toBe(false);
    expect(adminCan(support, "developer:extend_trial")).toBe(false);
  });

  it("감사 로그는 최고관리자만 본다", () => {
    expect(adminCan(actor(), "audit:read")).toBe(true);
    expect(adminCan(actor({ adminTier: "operator" }), "audit:read")).toBe(false);
    expect(adminCan(actor({ adminTier: "support" }), "audit:read")).toBe(false);
  });

  it("관리자가 아니면 아무것도 못 한다 (등급이 붙어 있어도)", () => {
    // profiles.admin_tier는 기본값이 super다 — role을 보지 않으면 개발자가 전권을 갖는다
    const developer = actor({ role: "developer", adminTier: "super" });

    for (const action of ADMIN_ACTIONS) {
      expect(adminCan(developer, action), action).toBe(false);
    }
  });

  it("정지된 관리자는 아무것도 못 한다", () => {
    const suspended = actor({ suspendedAt: "2026-09-12T00:00:00.000Z" });

    for (const action of ADMIN_ACTIONS) {
      expect(adminCan(suspended, action), action).toBe(false);
    }
  });

  it("모르는 등급·모르는 행위는 거부한다 (애매하면 막는다)", () => {
    expect(adminCan(actor({ adminTier: "god" as never }), "developer:read")).toBe(false);
    expect(adminCan(actor({ adminTier: null }), "developer:read")).toBe(false);
    expect(adminCan(actor(), "무언가:새로운" as never)).toBe(false);
  });

  it("행위 목록에 빠짐이 없다 (새 행위를 만들면 여기 먼저 추가하게 된다)", () => {
    expect([...ADMIN_ACTIONS].sort()).toEqual([
      "artifact:block",
      "audit:read",
      "developer:extend_trial",
      "developer:read",
      "developer:suspend",
      "policy:change",
      "usage:read",
    ]);
  });
});
