import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/0017_persistent_run_worker.sql"),
  "utf8",
);

describe("[T034] 지속 worker DB 경계", () => {
  it("동일 불변 버전의 테스트 증거와 재시도 이벤트를 중복 저장하지 않는다", () => {
    expect(sql).toMatch(/test_evidence[\s\S]*run_id, phase, code_hash, test_hash/i);
    expect(sql).toMatch(/add column if not exists dedupe_key/i);
    expect(sql).toMatch(/run_events \(run_id, dedupe_key\)/i);
    expect(sql).toMatch(/where dedupe_key is not null/i);
  });

  it("이벤트 append는 작업 행 잠금과 dedupe key를 함께 사용한다", () => {
    expect(sql).toMatch(/function public\.append_run_event/i);
    expect(sql).toMatch(/from public\.runs where id = p_run_id for update/i);
    expect(sql).toMatch(/where run_id = p_run_id and dedupe_key = p_dedupe_key/i);
  });

  it("lease 소유 worker만 작업을 최종 상태로 전환한다", () => {
    expect(sql).toMatch(/function public\.finish_persistent_run/i);
    expect(sql).toMatch(/lease_owner = p_worker_id/i);
    expect(sql).toMatch(/status in \('running', 'cancel_requested'\)/i);
    expect(sql).toMatch(/cancellation_requested_at is not null then 'cancelled'/i);
  });

  it("두 RPC 모두 브라우저 역할에서 차단하고 service role에만 허용한다", () => {
    expect(sql.match(/revoke all on function public\./gi)?.length).toBe(2);
    expect(sql.match(/grant execute on function public\./gi)?.length).toBe(2);
    expect(sql).toMatch(/from public, anon, authenticated/i);
    expect(sql).toMatch(/to service_role/i);
  });
});
