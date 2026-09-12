import { describe, expect, it } from "vitest";
import {
  listDevelopers,
  setSuspended,
  extendTrial,
  TRIAL_EXTENSION_DAYS,
} from "@/lib/admin/developers";

/**
 * [P8-2] 개발자 관리 (FR-014).
 *
 * 관리자만 부른다 — 권한 판정은 라우트가 `adminCan`으로 하고, 여기서는
 * **소유자 조건을 걸지 않는다**(관리자는 남의 계정을 다뤄야 한다).
 * 그래서 이 모듈을 실수로 개발자 경로에서 부르면 안 된다.
 */

function fakeAdmin(rows: Record<string, unknown>[] = []) {
  const updates: { values: Record<string, unknown>; where: unknown[] }[] = [];
  const client = {
    from() {
      return {
        select() {
          const chain = {
            order: () => chain,
            limit: () => chain,
            ilike: () => chain,
            then: (resolve: (r: unknown) => unknown) => resolve({ data: rows, error: null }),
          };
          return chain;
        },
        update(values: Record<string, unknown>) {
          const where: unknown[] = [];
          const chain = {
            eq(column: string, value: unknown) {
              where.push([column, value]);
              return chain;
            },
            select: () => chain,
            async single() {
              updates.push({ values, where });
              return { data: { id: "user-9" }, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
  return { client: client as never, updates };
}

const ROW = {
  id: "user-9",
  email: "dev@example.com",
  role: "developer",
  grade: "basic",
  subscription_status: "active",
  trial_ends_at: "2026-09-20T00:00:00.000Z",
  suspended_at: null,
  suspended_reason: null,
  created_at: "2026-09-01T00:00:00.000Z",
};

describe("[P8-2] listDevelopers", () => {
  it("한 화면에 필요한 것만 골라 온다 (SC-006)", async () => {
    const { client } = fakeAdmin([ROW]);

    const developers = await listDevelopers(client);

    expect(developers[0]).toEqual({
      id: "user-9",
      email: "dev@example.com",
      role: "developer",
      grade: "basic",
      subscriptionStatus: "active",
      trialEndsAt: "2026-09-20T00:00:00.000Z",
      suspendedAt: null,
      suspendedReason: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("비어 있어도 터지지 않는다", async () => {
    const { client } = fakeAdmin([]);
    expect(await listDevelopers(client)).toEqual([]);
  });
});

describe("[P8-2] setSuspended", () => {
  it("정지하면 시각과 사유를 함께 남긴다", async () => {
    const { client, updates } = fakeAdmin();

    await setSuspended(client, "user-9", true, "불법 콘텐츠", new Date("2026-09-12T00:00:00.000Z"));

    expect(updates[0].values).toEqual({
      suspended_at: "2026-09-12T00:00:00.000Z",
      suspended_reason: "불법 콘텐츠",
    });
    expect(updates[0].where).toEqual([["id", "user-9"]]);
  });

  it("해제하면 둘 다 지운다 (사유가 남아 있으면 정지된 것처럼 보인다)", async () => {
    const { client, updates } = fakeAdmin();

    await setSuspended(client, "user-9", false);

    expect(updates[0].values).toEqual({ suspended_at: null, suspended_reason: null });
  });
});

describe("[P8-2] extendTrial", () => {
  it("체험을 7일 늘린다", async () => {
    const { client, updates } = fakeAdmin();

    await extendTrial(client, "user-9", "2026-09-20T00:00:00.000Z", new Date("2026-09-12T00:00:00.000Z"));

    expect(TRIAL_EXTENSION_DAYS).toBe(7);
    expect(updates[0].values).toEqual({ trial_ends_at: "2026-09-27T00:00:00.000Z" });
  });

  it("이미 지난 체험은 **오늘부터** 다시 센다 (과거에 더하면 여전히 만료다)", async () => {
    const { client, updates } = fakeAdmin();

    await extendTrial(client, "user-9", "2026-09-01T00:00:00.000Z", new Date("2026-09-12T00:00:00.000Z"));

    expect(updates[0].values).toEqual({ trial_ends_at: "2026-09-19T00:00:00.000Z" });
  });

  it("만료일이 없으면 오늘부터 센다", async () => {
    const { client, updates } = fakeAdmin();

    await extendTrial(client, "user-9", null, new Date("2026-09-12T00:00:00.000Z"));

    expect(updates[0].values).toEqual({ trial_ends_at: "2026-09-19T00:00:00.000Z" });
  });
});

/**
 * [P8-2b][P8-4a] 등급 부여와 계정별 한도 (FR-035·036).
 */
describe("[P8-2b] grantGrade", () => {
  it("등급과 만료일·사유를 함께 남긴다", async () => {
    const { grantGrade } = await import("@/lib/admin/developers");
    const { client, updates } = fakeAdmin();

    await grantGrade(client, "user-9", {
      grade: "basic",
      until: "2026-12-31T00:00:00.000Z",
      reason: "가을 강의 수강생",
    });

    expect(updates[0].values).toEqual({
      granted_grade: "basic",
      granted_until: "2026-12-31T00:00:00.000Z",
      granted_reason: "가을 강의 수강생",
    });
  });

  it("해제하면 세 값을 모두 지운다 (사유만 남으면 준 것처럼 보인다)", async () => {
    const { grantGrade } = await import("@/lib/admin/developers");
    const { client, updates } = fakeAdmin();

    await grantGrade(client, "user-9", null);

    expect(updates[0].values).toEqual({
      granted_grade: null,
      granted_until: null,
      granted_reason: null,
    });
  });

  it("만료일 없이도 줄 수 있다 (무기한)", async () => {
    const { grantGrade } = await import("@/lib/admin/developers");
    const { client, updates } = fakeAdmin();

    await grantGrade(client, "user-9", { grade: "pro" });

    expect(updates[0].values).toMatchObject({ granted_grade: "pro", granted_until: null });
  });
});

describe("[P8-4a] setMonthlyLimit", () => {
  it("한도를 지정한다", async () => {
    const { setMonthlyLimit } = await import("@/lib/admin/developers");
    const { client, updates } = fakeAdmin();

    await setMonthlyLimit(client, "user-9", 300000);

    expect(updates[0].values).toEqual({ monthly_token_limit: 300000 });
  });

  it("0도 그대로 저장한다 (완전 차단이며 비움과 다르다)", async () => {
    const { setMonthlyLimit } = await import("@/lib/admin/developers");
    const { client, updates } = fakeAdmin();

    await setMonthlyLimit(client, "user-9", 0);

    expect(updates[0].values).toEqual({ monthly_token_limit: 0 });
  });

  it("null이면 등급 기본값으로 되돌린다", async () => {
    const { setMonthlyLimit } = await import("@/lib/admin/developers");
    const { client, updates } = fakeAdmin();

    await setMonthlyLimit(client, "user-9", null);

    expect(updates[0].values).toEqual({ monthly_token_limit: null });
  });

  it("음수는 거부한다 (DB 제약에 닿기 전에 막는다)", async () => {
    const { setMonthlyLimit } = await import("@/lib/admin/developers");
    const { client } = fakeAdmin();

    await expect(setMonthlyLimit(client, "user-9", -1)).rejects.toThrow(/0 이상/);
  });
});
