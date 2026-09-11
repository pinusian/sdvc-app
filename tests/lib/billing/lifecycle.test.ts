import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  lockArtifacts,
  restoreArtifacts,
  GRACE_DAYS,
} from "@/lib/billing/lifecycle";

/**
 * [P6-7] 해지·체험 만료 시 산출물 처리 (FR-023·FR-027).
 *
 * 즉시 비공개 → 유예 후 삭제. 유예 안에 결제하면 **원래 공개범위 그대로**
 * 복구되어야 하므로, 잠글 때 원래 값을 기억해 둔다.
 */

/** projects/profiles 접근만 흉내낸 가짜 */
function fakeAdmin(projects: { id: string; visibility: string; locked_from_visibility: string | null }[]) {
  const calls: { table: string; op: string; values?: Record<string, unknown>; where: unknown[] }[] = [];

  const client = {
    from(table: string) {
      return {
        select() {
          const where: unknown[] = [];
          const chain = {
            eq(c: string, v: unknown) {
              where.push([c, v]);
              return chain;
            },
            then(resolve: (r: unknown) => unknown) {
              calls.push({ table, op: "select", where });
              return resolve({ data: projects, error: null });
            },
          };
          return chain;
        },
        update(values: Record<string, unknown>) {
          const where: unknown[] = [];
          const chain = {
            eq(c: string, v: unknown) {
              where.push([c, v]);
              return chain;
            },
            then(resolve: (r: unknown) => unknown) {
              calls.push({ table, op: "update", values, where });
              return resolve({ data: null, error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return { admin: client as never, calls };
}

const NOW = new Date("2026-09-12T00:00:00Z");

describe("[P6-7] lockArtifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("해지면 30일 유예로 잠근다 (FR-023)", async () => {
    const { admin, calls } = fakeAdmin([
      { id: "p1", visibility: "public", locked_from_visibility: null },
    ]);

    await lockArtifacts(admin, "user-1", "canceled", NOW);

    const profile = calls.find((c) => c.table === "profiles" && c.op === "update");
    expect(profile?.values?.artifacts_locked_at).toBe(NOW.toISOString());
    expect(profile?.values?.artifacts_purge_after).toBe(
      new Date("2026-10-12T00:00:00Z").toISOString(),
    );
    expect(GRACE_DAYS.canceled).toBe(30);
  });

  it("체험 만료면 10일 유예로 잠근다 (FR-027)", async () => {
    const { admin, calls } = fakeAdmin([
      { id: "p1", visibility: "link", locked_from_visibility: null },
    ]);

    await lockArtifacts(admin, "user-1", "trial_expired", NOW);

    const profile = calls.find((c) => c.table === "profiles" && c.op === "update");
    expect(profile?.values?.artifacts_purge_after).toBe(
      new Date("2026-09-22T00:00:00Z").toISOString(),
    );
    expect(GRACE_DAYS.trial_expired).toBe(10);
  });

  it("공개돼 있던 것을 비공개로 바꾸되 원래 값을 기억한다", async () => {
    const { admin, calls } = fakeAdmin([
      { id: "p1", visibility: "public", locked_from_visibility: null },
      { id: "p2", visibility: "link", locked_from_visibility: null },
    ]);

    await lockArtifacts(admin, "user-1", "canceled", NOW);

    const updates = calls.filter((c) => c.table === "projects" && c.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates[0].values).toEqual({ visibility: "private", locked_from_visibility: "public" });
    expect(updates[0].where).toContainEqual(["id", "p1"]);
    expect(updates[1].values).toEqual({ visibility: "private", locked_from_visibility: "link" });
  });

  it("원래 비공개였던 것은 건드리지 않는다", async () => {
    const { admin, calls } = fakeAdmin([
      { id: "p1", visibility: "private", locked_from_visibility: null },
    ]);

    await lockArtifacts(admin, "user-1", "canceled", NOW);

    expect(calls.filter((c) => c.table === "projects" && c.op === "update")).toHaveLength(0);
  });

  it("이미 잠근 것을 또 잠가도 원래 값을 덮어쓰지 않는다", async () => {
    // 두 번 잠기면 "원래 public이었다"는 기억이 "private"으로 덮여
    // 복구해도 공개되지 않는다.
    const { admin, calls } = fakeAdmin([
      { id: "p1", visibility: "private", locked_from_visibility: "public" },
    ]);

    await lockArtifacts(admin, "user-1", "canceled", NOW);

    expect(calls.filter((c) => c.table === "projects" && c.op === "update")).toHaveLength(0);
  });
});

describe("[P6-7] restoreArtifacts", () => {
  it("결제하면 원래 공개범위로 되돌리고 유예를 지운다", async () => {
    const { admin, calls } = fakeAdmin([
      { id: "p1", visibility: "private", locked_from_visibility: "public" },
      { id: "p2", visibility: "private", locked_from_visibility: "link" },
    ]);

    await restoreArtifacts(admin, "user-1");

    const updates = calls.filter((c) => c.table === "projects" && c.op === "update");
    expect(updates[0].values).toEqual({ visibility: "public", locked_from_visibility: null });
    expect(updates[1].values).toEqual({ visibility: "link", locked_from_visibility: null });

    const profile = calls.find((c) => c.table === "profiles" && c.op === "update");
    expect(profile?.values).toEqual({ artifacts_locked_at: null, artifacts_purge_after: null });
  });

  it("잠긴 적 없는 프로젝트는 건드리지 않는다", async () => {
    const { admin, calls } = fakeAdmin([
      { id: "p1", visibility: "link", locked_from_visibility: null },
    ]);

    await restoreArtifacts(admin, "user-1");

    expect(calls.filter((c) => c.table === "projects" && c.op === "update")).toHaveLength(0);
  });
});
