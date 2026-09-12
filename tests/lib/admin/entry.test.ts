import { describe, expect, it } from "vitest";
import { adminEntry, landingAfterAdminLogin } from "@/lib/admin/entry";
import type { AdminActor } from "@/lib/admin/access";

/**
 * [P8-11a] 관리자 입구 판정 (FR-038).
 *
 * 세 갈래를 한 곳에서 정한다: 로그인을 받을 것인가, 콘솔을 보일 것인가,
 * 없는 척할 것인가. 화면마다 제각각 판정하면 나중에 관리자 하위 화면을
 * 늘릴 때 한 군데가 빠진다.
 */

const superAdmin: AdminActor = { role: "admin", adminTier: "super", suspendedAt: null };
const support: AdminActor = { role: "admin", adminTier: "support", suspendedAt: null };
const developer: AdminActor = { role: "developer", adminTier: "super", suspendedAt: null };

describe("[P8-11a] adminEntry", () => {
  it("로그인하지 않았으면 그 자리에서 로그인을 받는다 (login으로 튕기지 않는다)", () => {
    expect(adminEntry(null)).toBe("login");
  });

  it("관리자면 콘솔을 연다", () => {
    expect(adminEntry(superAdmin)).toBe("console");
  });

  it("읽기 전용 관리자도 콘솔은 연다", () => {
    expect(adminEntry(support)).toBe("console");
  });

  it("관리자가 아니면 없는 척한다 — admin_tier가 남아 있어도", () => {
    expect(adminEntry(developer)).toBe("not_found");
  });

  it("정지된 관리자도 없는 척한다", () => {
    expect(adminEntry({ ...superAdmin, suspendedAt: new Date().toISOString() })).toBe("not_found");
  });

  it("프로필을 못 읽었으면(역할 빈 값) 없는 척한다 — 애매하면 막는다", () => {
    expect(adminEntry({ role: "", adminTier: null })).toBe("not_found");
  });
});

describe("[P8-11a] landingAfterAdminLogin", () => {
  it("관리자는 관리자 화면으로", () => {
    expect(landingAfterAdminLogin(superAdmin)).toBe("/admin");
  });

  it("관리자가 아니면 말없이 자기 화면으로 — '관리자가 아닙니다'라고 하지 않는다", () => {
    expect(landingAfterAdminLogin(developer)).toBe("/dashboard");
  });

  it("로그인 직후 프로필을 못 읽었어도 막다른 길로 보내지 않는다", () => {
    expect(landingAfterAdminLogin(null)).toBe("/dashboard");
  });
});
