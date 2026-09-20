import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/0016_persistent_runs.sql"),
  "utf8",
);

describe("[T033] 지속 작업 DB 경계", () => {
  it("runs·run_events·test_evidence를 소유 프로젝트와 불변 증거에 결부한다", () => {
    expect(sql).toMatch(/create table if not exists public\.runs/i);
    expect(sql).toMatch(/create table if not exists public\.run_events/i);
    expect(sql).toMatch(/create table if not exists public\.test_evidence/i);
    expect(sql).toMatch(/document_bundle_hash[\s\S]*\^\[a-f0-9\]\{64\}/i);
    expect(sql).toMatch(/phase text not null check \(phase in \('red', 'green', 'refactor'\)\)/i);
  });

  it("사용자별 멱등키와 이벤트 순서를 유일하게 강제한다", () => {
    expect(sql).toMatch(/unique \(owner_id, idempotency_key\)/i);
    expect(sql).toMatch(/unique \(run_id, sequence\)/i);
    expect(sql).toMatch(/on conflict \(owner_id, idempotency_key\) do nothing/i);
  });

  it("만료 lease만 원자적으로 인수하고 취소 요청 작업은 인수하지 않는다", () => {
    expect(sql).toMatch(/create or replace function public\.claim_run_lease/i);
    expect(sql).toMatch(/lease_expires_at is null or lease_expires_at <= p_now/i);
    expect(sql).toMatch(/cancellation_requested_at is null/i);
    expect(sql).toMatch(/returning \*/i);
  });

  it("세 테이블과 RPC를 브라우저 역할에서 차단한다", () => {
    for (const table of ["runs", "run_events", "test_evidence"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${table} from anon, authenticated`, "i"));
    }
    expect(sql.match(/grant execute on function public\./gi)?.length).toBe(3);
  });
});
