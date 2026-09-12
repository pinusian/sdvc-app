import { describe, expect, it, vi } from "vitest";

/**
 * [P6-7b] 유예 만료 처리 — 매일 한 번 도는 예약 작업이 부른다.
 *
 * 두 가지를 한다:
 *   ① 체험이 끝났는데 결제 안 한 사람의 산출물을 잠근다 (FR-027, 10일 유예)
 *   ② 유예 기한이 지난 사람의 산출물을 **삭제**한다 (FR-023·FR-027)
 *
 * 삭제는 되돌릴 수 없으므로 **기한이 확실히 지난 것만** 지운다.
 */

const lockArtifacts = vi.fn();
const deleteArtifactFiles = vi.fn();
const deleteAllVersions = vi.fn();

vi.mock("@/lib/billing/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/lifecycle")>()),
  lockArtifacts: (...args: unknown[]) => lockArtifacts(...args),
}));

vi.mock("@/lib/artifacts/storage", () => ({
  deleteArtifactFiles: (...args: unknown[]) => deleteArtifactFiles(...args),
}));

vi.mock("@/lib/versions/store", () => ({
  deleteAllVersions: (...args: unknown[]) => deleteAllVersions(...args),
}));

const { runLifecycleSweep } = await import("@/lib/billing/purge");

const NOW = new Date("2026-09-12T00:00:00Z");

/** profiles/projects 조회·삭제를 흉내낸 가짜 */
function fakeAdmin(options: {
  expiredTrials?: { id: string }[];
  duePurge?: { id: string }[];
  projects?: Record<string, { id: string }[]>;
}) {
  const deleted: string[] = [];
  const client = {
    from(table: string) {
      if (table === "profiles") {
        return {
          select() {
            const filters: string[] = [];
            const chain = {
              eq(c: string) { filters.push("eq:" + c); return chain; },
              lt(c: string) { filters.push("lt:" + c); return chain; },
              lte(c: string) { filters.push("lte:" + c); return chain; },
              is(c: string) { filters.push("is:" + c); return chain; },
              not(c: string) { filters.push("not:" + c); return chain; },
              then(resolve: (r: unknown) => unknown) {
                // 체험 만료 조회와 유예 만료 조회를 필터로 구분한다
                const isPurge = filters.some((f) => f.includes("artifacts_purge_after"));
                return resolve({
                  data: isPurge ? (options.duePurge ?? []) : (options.expiredTrials ?? []),
                  error: null,
                });
              },
            };
            return chain;
          },
          update() {
            const chain = {
              eq() { return chain; },
              then(resolve: (r: unknown) => unknown) { return resolve({ data: null, error: null }); },
            };
            return chain;
          },
        };
      }
      // projects
      return {
        select() {
          const chain = {
            eq(_c: string, v: string) {
              chain._owner = v;
              return chain;
            },
            _owner: "",
            then(resolve: (r: unknown) => unknown) {
              return resolve({ data: options.projects?.[chain._owner] ?? [], error: null });
            },
          };
          return chain;
        },
        delete() {
          const chain = {
            eq(_c: string, v: string) {
              deleted.push(v);
              return chain;
            },
            then(resolve: (r: unknown) => unknown) { return resolve({ data: null, error: null }); },
          };
          return chain;
        },
      };
    },
  };
  return { admin: client as never, deleted };
}

describe("[P6-7b] runLifecycleSweep", () => {
  it("체험이 끝났는데 결제 안 한 사람을 잠근다 (10일 유예)", async () => {
    lockArtifacts.mockResolvedValue({ lockedCount: 1, purgeAfter: "x" });
    const { admin } = fakeAdmin({ expiredTrials: [{ id: "user-1" }, { id: "user-2" }] });

    const result = await runLifecycleSweep(admin, NOW);

    expect(result.locked).toBe(2);
    expect(lockArtifacts).toHaveBeenCalledWith(admin, "user-1", "trial_expired", NOW);
  });

  it("유예가 지난 사람의 파일과 프로젝트를 지운다", async () => {
    lockArtifacts.mockResolvedValue({ lockedCount: 0, purgeAfter: "x" });
    deleteArtifactFiles.mockResolvedValue(3);
    const { admin, deleted } = fakeAdmin({
      duePurge: [{ id: "user-9" }],
      projects: { "user-9": [{ id: "proj-1" }, { id: "proj-2" }] },
    });

    const result = await runLifecycleSweep(admin, NOW);

    expect(result.purgedProjects).toBe(2);
    // 파일을 먼저 지우고 기록을 나중에 ([P4-3]과 같은 순서)
    expect(deleteArtifactFiles).toHaveBeenCalledWith(admin, "proj-1");
    expect(deleted).toEqual(["proj-1", "proj-2"]);
  });

  it("한 사람에서 실패해도 나머지는 계속 처리한다", async () => {
    lockArtifacts.mockResolvedValue({ lockedCount: 0, purgeAfter: "x" });
    deleteArtifactFiles
      .mockRejectedValueOnce(new Error("storage down"))
      .mockResolvedValue(1);
    const { admin, deleted } = fakeAdmin({
      duePurge: [{ id: "user-9" }],
      projects: { "user-9": [{ id: "proj-1" }, { id: "proj-2" }] },
    });

    const result = await runLifecycleSweep(admin, NOW);

    // 파일을 못 지운 프로젝트는 기록도 남긴다 (주인 없는 파일이 남으면 안 된다)
    expect(deleted).toEqual(["proj-2"]);
    expect(result.failed).toBe(1);
  });

  it("대상이 없으면 아무것도 하지 않는다", async () => {
    const { admin, deleted } = fakeAdmin({});

    const result = await runLifecycleSweep(admin, NOW);

    expect(result).toMatchObject({ locked: 0, purgedProjects: 0, failed: 0 });
    expect(deleted).toEqual([]);
  });
});

/**
 * [P7-6c] 유예가 끝나 지울 때 되돌리기용 사본도 함께 지운다 (FR-023).
 */
describe("[P7-6c] 정리 작업이 버전 사본도 지운다", () => {
  it("프로젝트 파일과 사본을 모두 지운다", async () => {
    vi.clearAllMocks();
    deleteArtifactFiles.mockResolvedValue(2);
    deleteAllVersions.mockResolvedValue(5);
    const { admin } = fakeAdmin({
      duePurge: [{ id: "user-1" }],
      projects: { "user-1": [{ id: "proj-1" }] },
    });

    await runLifecycleSweep(admin, NOW);

    expect(deleteArtifactFiles).toHaveBeenCalledWith(expect.anything(), "proj-1");
    expect(deleteAllVersions).toHaveBeenCalledWith(expect.anything(), "proj-1");
  });
});
