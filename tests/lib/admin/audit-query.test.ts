import { describe, expect, it } from "vitest";
import { listAuditLogs, resolvePeopleEmails } from "@/lib/admin/audit";

/**
 * [P8-7d] 감사 기록 조회 (FR-041).
 *
 * 실물을 보니 8건 중 5건이 "콘솔 열었음"이었다 — 새로고침마다 한 건씩
 * 쌓여 의미 있는 행위를 파묻는다. **지우지는 않는다**(열람도 증거다,
 * Clarify 20). 대신 화면이 접을 수 있게 걸러서 준다.
 */

interface Call {
  eq: [string, unknown][];
  order?: string;
  limit?: number;
  in?: [string, unknown[]];
}

function fakeAdmin(rows: unknown[]) {
  const calls: Call[] = [];

  const client = {
    from() {
      const call: Call = { eq: [] };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          call.eq.push([col, val]);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          call.in = [col, vals];
          return chain;
        },
        order: (col: string) => {
          call.order = col;
          return chain;
        },
        limit: (n: number) => {
          call.limit = n;
          return chain;
        },
        then: (resolve: (r: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      return chain;
    },
  };

  return { client: client as never, calls };
}

const consoleOpen = (id: string) => ({
  id,
  actor_id: "admin-1",
  action: "developer:read",
  target_type: null,
  target_id: null,
  succeeded: true,
  detail: { via: "/admin", count: 5 },
  created_at: "2026-09-12T13:00:00Z",
});

const grant = (id: string) => ({
  id,
  actor_id: "admin-1",
  action: "policy:change",
  target_type: "profile",
  target_id: "user-9",
  succeeded: true,
  detail: { grade: "pro" },
  created_at: "2026-09-12T12:00:00Z",
});

describe("[P8-7d] listAuditLogs — 거르기", () => {
  it("최신부터 준다", async () => {
    const { client, calls } = fakeAdmin([grant("a")]);
    await listAuditLogs(client, {});
    expect(calls[0].order).toBe("created_at");
  });

  it("행위로 좁힌다", async () => {
    const { client, calls } = fakeAdmin([grant("a")]);
    await listAuditLogs(client, { action: "policy:change" });
    expect(calls[0].eq).toContainEqual(["action", "policy:change"]);
  });

  it("거부된 시도만 볼 수 있다", async () => {
    const { client, calls } = fakeAdmin([]);
    await listAuditLogs(client, { succeeded: false });
    expect(calls[0].eq).toContainEqual(["succeeded", false]);
  });

  it("화면 열람을 접으면 빼고 주되, 몇 건을 접었는지 알려준다", async () => {
    const { client } = fakeAdmin([consoleOpen("a"), grant("b"), consoleOpen("c")]);

    const result = await listAuditLogs(client, { hideConsoleOpens: true });

    expect(result.rows.map((r) => r.id)).toEqual(["b"]);
    expect(result.hiddenCount).toBe(2);
  });

  it("접지 않으면 전부 준다", async () => {
    const { client } = fakeAdmin([consoleOpen("a"), grant("b")]);

    const result = await listAuditLogs(client, {});

    expect(result.rows).toHaveLength(2);
    expect(result.hiddenCount).toBe(0);
  });

  it("접을 때는 더 넉넉히 읽는다 — 걸러내고 나면 화면이 텅 빈다", async () => {
    const { client, calls } = fakeAdmin([]);
    await listAuditLogs(client, { hideConsoleOpens: true, limit: 50 });
    expect(calls[0].limit).toBeGreaterThan(50);
  });

  it("접은 뒤에도 요청한 수를 넘기지 않는다", async () => {
    const many = Array.from({ length: 10 }, (_, i) => grant(`g${i}`));
    const { client } = fakeAdmin(many);

    const result = await listAuditLogs(client, { hideConsoleOpens: true, limit: 3 });

    expect(result.rows).toHaveLength(3);
  });
});

describe("[P8-7d] resolvePeopleEmails", () => {
  it("id 뭉치를 이메일로 바꿔준다", async () => {
    const { client, calls } = fakeAdmin([
      { id: "admin-1", email: "ops@example.com" },
      { id: "user-9", email: "student@example.com" },
    ]);

    const map = await resolvePeopleEmails(client, ["admin-1", "user-9", "admin-1", null]);

    expect(map).toEqual({ "admin-1": "ops@example.com", "user-9": "student@example.com" });
    // 같은 id를 두 번 묻지 않는다
    expect(calls[0].in?.[1]).toEqual(["admin-1", "user-9"]);
  });

  it("물어볼 id가 없으면 DB를 부르지 않는다", async () => {
    const { client, calls } = fakeAdmin([]);
    expect(await resolvePeopleEmails(client, [null, null])).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
