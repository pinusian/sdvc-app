import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions/check";

const admin = { id: "admin-1", role: "admin" as const };
const owner = { id: "dev-1", role: "developer" as const };
const otherDev = { id: "dev-2", role: "developer" as const };

describe("[P2-6] can() — WBS 2.4절 권한 매트릭스 기준", () => {
  it("개발자는 프로젝트를 생성할 수 있다", () => {
    expect(can(owner, "project:create")).toBe(true);
  });

  it("개발자는 자기 프로젝트를 읽고·수정하고·삭제할 수 있다", () => {
    const subject = { ownerId: owner.id };
    expect(can(owner, "project:read", subject)).toBe(true);
    expect(can(owner, "project:update", subject)).toBe(true);
    expect(can(owner, "project:delete", subject)).toBe(true);
    expect(can(owner, "project:visibility:update", subject)).toBe(true);
  });

  it("개발자는 남의 프로젝트를 읽거나 고칠 수 없다", () => {
    const subject = { ownerId: owner.id };
    expect(can(otherDev, "project:read", subject)).toBe(false);
    expect(can(otherDev, "project:delete", subject)).toBe(false);
  });

  it("개발자는 관리자 전용 기능을 쓸 수 없다", () => {
    expect(can(owner, "admin:developers:manage")).toBe(false);
    expect(can(owner, "admin:usage:view:all")).toBe(false);
  });

  it("서버관리자는 소유자와 무관하게 모든 프로젝트에 접근할 수 있다", () => {
    const subject = { ownerId: owner.id };
    expect(can(admin, "project:read", subject)).toBe(true);
    expect(can(admin, "project:delete", subject)).toBe(true);
  });

  it("서버관리자는 관리자 전용 기능도 쓸 수 있다", () => {
    expect(can(admin, "admin:developers:manage")).toBe(true);
    expect(can(admin, "admin:usage:view:all")).toBe(true);
  });

  it("소유자 정보가 필요한 행위인데 subject 없이 호출하면 거부한다(안전한 기본값)", () => {
    expect(can(owner, "project:read")).toBe(false);
  });
});
