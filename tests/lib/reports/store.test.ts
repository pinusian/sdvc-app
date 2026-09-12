import { describe, expect, it } from "vitest";
import {
  countOpenReports,
  createReport,
  listMyReports,
  listReports,
  updateReport,
} from "@/lib/reports/store";

/**
 * [P8-5b] 신고 저장·조회 (FR-013·043·044).
 *
 * `reports`는 RLS를 켜고 정책을 두지 않았다 = 서버 전용. 그래서 이 모듈은
 * secret key 클라이언트로만 부르고, **내 것만 보는 조건은 여기서 직접 건다**
 * (`projects/store.ts`와 같은 방식).
 */

interface Recorded {
  table: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  order?: [string, unknown];
  limit?: number;
  head?: boolean;
}

function fake(rows: unknown[] = [], count = 0) {
  const log: Recorded[] = [];

  const client = {
    from(table: string) {
      const rec: Recorded = { table, eq: [], in: [] };
      log.push(rec);

      const chain = {
        insert(row: Record<string, unknown>) {
          rec.insert = row;
          return chain;
        },
        update(row: Record<string, unknown>) {
          rec.update = row;
          return chain;
        },
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) rec.head = true;
          return chain;
        },
        eq(col: string, val: unknown) {
          rec.eq.push([col, val]);
          return chain;
        },
        in(col: string, vals: unknown[]) {
          rec.in.push([col, vals]);
          return chain;
        },
        order(col: string, opt: unknown) {
          rec.order = [col, opt];
          return chain;
        },
        limit(n: number) {
          rec.limit = n;
          return chain;
        },
        async single() {
          return { data: rows[0] ?? null, error: null };
        },
        async maybeSingle() {
          return { data: rows[0] ?? null, error: null };
        },
        then: (resolve: (r: unknown) => unknown) =>
          resolve({ data: rows, error: null, count }),
      };
      return chain;
    },
  };

  return { client: client as never, log };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "rep-1",
  reporter_id: "dev-1",
  reporter_email: "dev@example.com",
  category: "content",
  body: "남의 홈페이지에 이상한 내용이 있습니다.",
  target_url: "https://sdvc-app.vercel.app/site/bakery",
  target_project_id: null,
  status: "open",
  admin_note: null,
  handled_by: null,
  handled_at: null,
  created_at: "2026-09-12T13:00:00Z",
  ...over,
});

describe("[P8-5b] createReport", () => {
  it("신고자와 내용을 남긴다", async () => {
    const { client, log } = fake([row()]);

    await createReport(client, {
      reporterId: "dev-1",
      reporterEmail: "dev@example.com",
      category: "content",
      body: "남의 홈페이지에 이상한 내용이 있습니다.",
      targetUrl: "https://sdvc-app.vercel.app/site/bakery",
    });

    const insert = log.find((l) => l.insert);
    expect(insert?.table).toBe("reports");
    expect(insert?.insert).toMatchObject({
      reporter_id: "dev-1",
      category: "content",
      status: "open",
    });
  });

  it("신고 당시 주소도 함께 남긴다 — 탈퇴해도 누가 신고했는지 흔적이 남는다", async () => {
    const { client, log } = fake([row()]);
    await createReport(client, {
      reporterId: "dev-1",
      reporterEmail: "dev@example.com",
      category: "bug",
      body: "열 자가 넘는 내용입니다.",
      targetUrl: null,
    });
    expect(log[0].insert?.reporter_email).toBe("dev@example.com");
  });

  it("산출물 주소가 프로젝트로 짚어지면 그 프로젝트를 걸어둔다 — 바로 가릴 수 있게", async () => {
    const { client, log } = fake([{ id: "proj-7" }]);

    await createReport(client, {
      reporterId: "dev-1",
      reporterEmail: "dev@example.com",
      category: "content",
      body: "남의 홈페이지에 이상한 내용이 있습니다.",
      targetUrl: "https://sdvc-app.vercel.app/site/bakery/index.html",
    });

    // projects에서 slug로 찾아본 뒤 insert에 실어야 한다
    const lookup = log.find((l) => l.table === "projects");
    expect(lookup?.eq).toContainEqual(["slug", "bakery"]);
    const insert = log.find((l) => l.table === "reports");
    expect(insert?.insert?.target_project_id).toBe("proj-7");
  });

  it("짚히지 않는 주소여도 신고는 접수된다", async () => {
    // projects 조회는 빈손이고(아래 maybeSingle이 null), insert 결과만 돌아온다
    const { client, log } = fake([row({ target_project_id: null })]);
    await createReport(client, {
      reporterId: "dev-1",
      reporterEmail: "dev@example.com",
      category: "content",
      body: "열 자가 넘는 내용입니다.",
      targetUrl: "https://example.com/누군가",
    });
    const insert = log.find((l) => l.table === "reports");
    expect(insert?.insert?.target_project_id).toBeNull();
  });
});

describe("[P8-5b] countOpenReports", () => {
  it("내 미처리 신고만 센다", async () => {
    const { client, log } = fake([], 3);
    expect(await countOpenReports(client, "dev-1")).toBe(3);
    expect(log[0].eq).toContainEqual(["reporter_id", "dev-1"]);
    expect(log[0].in).toContainEqual(["status", ["open", "in_progress"]]);
    // 세기만 할 뿐 내용은 받아오지 않는다
    expect(log[0].head).toBe(true);
  });
});

describe("[P8-5b] listMyReports", () => {
  it("내 것만, 최신부터", async () => {
    const { client, log } = fake([row()]);
    const mine = await listMyReports(client, "dev-1");

    expect(log[0].eq).toContainEqual(["reporter_id", "dev-1"]);
    expect(log[0].order?.[0]).toBe("created_at");
    expect(mine[0].id).toBe("rep-1");
  });

  it("처리 결과(관리자 답)를 함께 준다 — 그걸 보려고 오는 화면이다", async () => {
    const { client } = fake([row({ status: "resolved", admin_note: "해당 산출물을 가렸습니다." })]);
    const mine = await listMyReports(client, "dev-1");
    expect(mine[0].adminNote).toBe("해당 산출물을 가렸습니다.");
    expect(mine[0].status).toBe("resolved");
  });
});

describe("[P8-5b] listReports (접수함)", () => {
  it("상태로 좁힐 수 있다", async () => {
    const { client, log } = fake([row()]);
    await listReports(client, { status: "open" });
    expect(log[0].eq).toContainEqual(["status", "open"]);
  });

  it("소유자 조건을 걸지 않는다 — 관리자는 남의 신고를 봐야 한다", async () => {
    const { client, log } = fake([row()]);
    await listReports(client, {});
    expect(log[0].eq.some(([col]) => col === "reporter_id")).toBe(false);
  });
});

describe("[P8-5b] updateReport", () => {
  it("상태와 답을 남기고 누가 처리했는지 기록한다", async () => {
    const { client, log } = fake([row()]);

    await updateReport(client, "rep-1", {
      status: "resolved",
      adminNote: "가렸습니다.",
      handledBy: "admin-1",
    });

    expect(log[0].update).toMatchObject({
      status: "resolved",
      admin_note: "가렸습니다.",
      handled_by: "admin-1",
    });
    expect(log[0].update?.handled_at).toBeTruthy();
    expect(log[0].eq).toContainEqual(["id", "rep-1"]);
  });

  it("다시 열면 처리 흔적을 지운다 — 처리한 적 없는 것처럼 보여야 한다", async () => {
    const { client, log } = fake([row()]);
    await updateReport(client, "rep-1", { status: "open", adminNote: null, handledBy: "admin-1" });
    expect(log[0].update?.handled_at).toBeNull();
  });
});
