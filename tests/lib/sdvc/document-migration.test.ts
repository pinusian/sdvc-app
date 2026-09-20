import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/0014_document_workflow.sql"),
  "utf8",
);

describe("[T028] 문서 버전·승인 DB 경계", () => {
  it("문서·승인·현재 단계 테이블을 프로젝트에 결부한다", () => {
    expect(sql).toMatch(/create table if not exists public\.document_workflows/i);
    expect(sql).toMatch(/create table if not exists public\.document_versions/i);
    expect(sql).toMatch(/create table if not exists public\.document_approvals/i);
    expect(sql.match(/references public\.projects\(id\)/gi)?.length).toBeGreaterThanOrEqual(3);
  });

  it("버전 유일성·해시 형식과 승인 버전의 복합 외래키를 강제한다", () => {
    expect(sql).toMatch(/unique \(project_id, kind, version\)/i);
    expect(sql).toMatch(/content_hash text not null check \(content_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/i);
    expect(sql).toMatch(/foreign key \(version_id, project_id, kind\)[\s\S]*document_versions/i);
  });

  it("세 테이블 모두 RLS와 브라우저 역할 차단을 적용한다", () => {
    for (const table of ["document_workflows", "document_versions", "document_approvals"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${table} from anon, authenticated`, "i"));
    }
  });
});
