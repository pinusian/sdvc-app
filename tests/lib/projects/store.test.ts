import { describe, expect, it } from "vitest";
import {
  createProject,
  getProjectById,
  getProjectBySlug,
  listProjects,
  setProjectStatus,
  setProjectVisibility,
  deleteProjectRow,
  isSlugTaken,
} from "@/lib/projects/store";

/**
 * [P4-3] projects 표 접근. conversations와 같은 원칙 —
 * RLS 정책이 없으므로 소유자 조건은 코드가 매번 직접 건다.
 */

type Result = { data: unknown; error: unknown };

function fakeSupabase(result: Result = { data: null, error: null }) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args.length === 1 ? args[0] : args);
  };

  const builder: Record<string, unknown> = {};
  for (const name of ["insert", "select", "update", "delete", "eq", "order", "limit"]) {
    builder[name] = (...args: unknown[]) => {
      record(name, ...args);
      return builder;
    };
  }
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown) => resolve(result);

  const client = {
    from: (table: string) => {
      record("from", table);
      return builder;
    },
  };
  return { client: client as never, calls };
}

const ROW = {
  id: "proj-1",
  owner_id: "user-1",
  name: "내 홈페이지",
  slug: "my-homepage",
  visibility: "private",
  status: "draft",
};

describe("[P4-3] projects 저장소", () => {
  it("프로젝트를 만들면 소유자·이름·주소가 저장된다", async () => {
    const { client, calls } = fakeSupabase({ data: ROW, error: null });

    const project = await createProject(client, {
      ownerId: "user-1",
      name: "내 홈페이지",
      slug: "my-homepage",
    });

    expect(calls.from).toContain("projects");
    expect(calls.insert[0]).toMatchObject({
      owner_id: "user-1",
      name: "내 홈페이지",
      slug: "my-homepage",
    });
    expect(project).toEqual({
      id: "proj-1",
      ownerId: "user-1",
      name: "내 홈페이지",
      slug: "my-homepage",
      visibility: "private",
      status: "draft",
      // [P8-6]에서 늘어난 값 — 차단된 적이 없으면 null
      blockedAt: null,
    });
  });

  it("id로 찾을 때 소유자 조건을 함께 건다", async () => {
    const { client, calls } = fakeSupabase({ data: ROW, error: null });

    await getProjectById(client, "proj-1", "user-1");

    expect(calls.eq).toContainEqual(["id", "proj-1"]);
    expect(calls.eq).toContainEqual(["owner_id", "user-1"]);
  });

  it("주소로 찾을 때는 소유자 조건을 걸지 않는다 (공개 열람용)", async () => {
    const { client, calls } = fakeSupabase({ data: ROW, error: null });

    const project = await getProjectBySlug(client, "my-homepage");

    expect(calls.eq).toContainEqual(["slug", "my-homepage"]);
    expect(calls.eq.flat()).not.toContain("owner_id");
    expect(project?.slug).toBe("my-homepage");
  });

  it("없는 프로젝트는 null을 준다", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await getProjectById(client, "x", "user-1")).toBeNull();
    expect(await getProjectBySlug(client, "x")).toBeNull();
  });

  it("목록은 내 것만, 최신 순으로 가져온다", async () => {
    const { client, calls } = fakeSupabase({ data: [ROW], error: null });

    const projects = await listProjects(client, "user-1");

    expect(calls.eq).toContainEqual(["owner_id", "user-1"]);
    expect(calls.order).toContainEqual(["created_at", { ascending: false }]);
    expect(projects).toHaveLength(1);
  });

  it("주소가 이미 쓰이는지 확인한다", async () => {
    const taken = fakeSupabase({ data: { id: "proj-1" }, error: null });
    expect(await isSlugTaken(taken.client, "my-homepage")).toBe(true);

    const free = fakeSupabase({ data: null, error: null });
    expect(await isSlugTaken(free.client, "free-slug")).toBe(false);
  });

  it("상태를 바꿀 때도 소유자 조건을 건다", async () => {
    const { client, calls } = fakeSupabase({ data: ROW, error: null });

    await setProjectStatus(client, "proj-1", "user-1", "deployed");

    expect(calls.update[0]).toMatchObject({ status: "deployed" });
    expect(calls.eq).toContainEqual(["owner_id", "user-1"]);
  });

  it("삭제도 소유자 조건을 걸고, 지운 행이 없으면 false", async () => {
    const deleted = fakeSupabase({ data: { id: "proj-1" }, error: null });
    expect(await deleteProjectRow(deleted.client, "proj-1", "user-1")).toBe(true);
    expect(deleted.calls.eq).toContainEqual(["owner_id", "user-1"]);

    const missing = fakeSupabase({ data: null, error: null });
    expect(await deleteProjectRow(missing.client, "proj-1", "user-1")).toBe(false);
  });

  it("DB 오류는 삼키지 않는다", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "permission denied" } });
    await expect(
      createProject(client, { ownerId: "u", name: "n", slug: "s" }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("[P5-3] 공개범위 변경", () => {
  it("소유자 조건을 걸고 바꾼다", async () => {
    const { client, calls } = fakeSupabase({ data: { ...ROW, visibility: "link" }, error: null });

    await setProjectVisibility(client, "proj-1", "user-1", "link");

    expect(calls.from).toContain("projects");
    expect(calls.update[0]).toMatchObject({ visibility: "link" });
    expect(calls.eq).toContainEqual(["id", "proj-1"]);
    expect(calls.eq).toContainEqual(["owner_id", "user-1"]);
  });

  it("DB가 거부하면 알린다", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "violates check constraint" } });

    await expect(
      setProjectVisibility(client, "proj-1", "user-1", "link"),
    ).rejects.toThrow(/check constraint/);
  });
});
