import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0012_learner_access_boundary.sql"),
  "utf8",
).toLowerCase();

describe("[T014] 수강생 접근 경계 마이그레이션", () => {
  it("기존 세션과 별개로 판정할 활성 상태를 추가한다", () => {
    expect(sql).toMatch(/alter table public\.profiles[\s\S]*is_active boolean not null default true/);
  });

  it("차단 수행자와 상태 변경 시각을 보존한다", () => {
    expect(sql).toContain("suspended_by uuid references auth.users(id) on delete set null");
    expect(sql).toContain("access_state_changed_at timestamptz");
  });

  it("감사 로그가 사유와 변경 전후 상태를 별도 필드로 보존한다", () => {
    expect(sql).toMatch(/alter table public\.admin_audit_logs[\s\S]*reason text/);
    expect(sql).toContain("previous_state jsonb");
    expect(sql).toContain("next_state jsonb");
  });

  it("재실행 가능한 DDL만 사용하고 브라우저 RLS 정책을 넓히지 않는다", () => {
    expect(sql.match(/add column if not exists/g)?.length).toBe(6);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
  });
});
