import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/0015_atomic_document_approval.sql",
);

describe("[T031] 원자적 문서 승인·단계 전이", () => {
  it("프로젝트 workflow 행을 잠근 한 트랜잭션에서 승인과 단계 전이를 처리한다", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/create or replace function public\.approve_document_and_advance/i);
    expect(sql).toMatch(/from public\.document_workflows[\s\S]*for update/i);
    expect(sql).toMatch(/order by version_row\.version desc[\s\S]*limit 1/i);
    expect(sql).toMatch(/v_latest_version_id <> p_version_id/i);
    expect(sql).toMatch(/if v_stage <> p_kind/i);
    expect(sql).toMatch(/insert into public\.document_approvals/i);
    expect(sql).toMatch(/update public\.document_workflows[\s\S]*current_stage/i);
  });

  it("동시 중복 요청은 기존 승인을 재사용하고 브라우저 역할의 직접 실행을 막는다", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/on conflict \(project_id, kind, version_id\) do nothing/i);
    expect(sql).toMatch(/if v_stage = v_next_stage[\s\S]*return query[\s\S]*false/i);
    expect(sql).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function[\s\S]*to service_role/i);
  });
});
