import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0013_provider_credentials.sql", "utf8");

describe("[T024] provider_credentials 서버 전용 저장 경계", () => {
  it("소유자별 OpenAI 자격을 하나의 인증 암호문으로 저장한다", () => {
    expect(sql).toMatch(/primary key\s*\(owner_id, provider\)/i);
    for (const column of ["ciphertext", "iv", "auth_tag", "key_version", "last_four"]) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(/provider\s*=\s*'openai'/i);
  });

  it("브라우저 역할의 직접 읽기·쓰기를 모두 철회하고 RLS를 켠다", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.provider_credentials from anon, authenticated/i);
    expect(sql).not.toMatch(/create policy/i);
  });
});
