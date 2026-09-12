import { describe, expect, it } from "vitest";
import { adminEntry, canOpenAdminConsole, landingAfterAdminLogin } from "@/lib/admin/entry";
import type { AdminActor } from "@/lib/admin/access";

/**
 * [P8-11a] 관리자 입구 판정 (FR-038).
 *
 * [P8-12] 갈래를 **둘로 줄였다**. 처음에는 로그인하지 않은 사람에게만
 * 로그인 화면을 주고 자격 없는 사람에게는 404를 줬는데, 같은 주소가
 * 로그아웃하면 로그인 화면을 내주므로 **숨기는 효과가 애초에 없었다**.
 * 남는 것은 엉뚱한 계정으로 로그인한 운영자가 맨 404에 갇히는 손해뿐이다.
 */

const superAdmin: AdminActor = { role: "admin", adminTier: "super", suspendedAt: null };
const support: AdminActor = { role: "admin", adminTier: "support", suspendedAt: null };
const developer: AdminActor = { role: "developer", adminTier: "super", suspendedAt: null };

describe("[P8-12] adminEntry", () => {
  it("로그인하지 않았으면 그 자리에서 로그인을 받는다 (login으로 튕기지 않는다)", () => {
    expect(adminEntry(null)).toBe("sign_in");
  });

  it("관리자면 콘솔을 연다", () => {
    expect(adminEntry(superAdmin)).toBe("console");
  });

  it("읽기 전용 관리자도 콘솔은 연다", () => {
    expect(adminEntry(support)).toBe("console");
  });

  it("자격 없는 계정으로 로그인했으면 **맨 404가 아니라** 다시 로그인을 받는다", () => {
    expect(adminEntry(developer)).toBe("sign_in");
  });

  it("정지된 관리자도 마찬가지", () => {
    expect(adminEntry({ ...superAdmin, suspendedAt: new Date().toISOString() })).toBe("sign_in");
  });

  it("프로필을 못 읽었으면(역할 빈 값) 콘솔은 열지 않는다 — 애매하면 막는다", () => {
    expect(adminEntry({ role: "", adminTier: null })).toBe("sign_in");
  });
});

describe("[P8-12] canOpenAdminConsole", () => {
  it("관리자만 참", () => {
    expect(canOpenAdminConsole(superAdmin)).toBe(true);
    expect(canOpenAdminConsole(support)).toBe(true);
  });

  it("그 밖에는 거짓 — 정지·비관리자·못 읽음", () => {
    expect(canOpenAdminConsole(developer)).toBe(false);
    expect(canOpenAdminConsole({ ...superAdmin, suspendedAt: "2026-01-01" })).toBe(false);
    expect(canOpenAdminConsole({ role: "", adminTier: null })).toBe(false);
    expect(canOpenAdminConsole(null)).toBe(false);
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
