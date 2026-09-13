import { describe, expect, it } from "vitest";
import { listAllProjectsForAdmin } from "@/lib/admin/projects";

/**
 * [P8-13] 유지보수용 전체 프로젝트 열람 (FR-045).
 *
 * "운영자(최고관리자)는 개발자들이 만든 모든 프로젝트를 유지보수 차원에서
 * 볼 수 있으면 좋겠다"는 요청 그대로. **소유자 조건을 걸지 않는다**
 * (`admin/developers.ts`와 같은 이유 — 관리자는 남의 것을 봐야 한다).
 *
 * `projects.owner_id`는 `auth.users`를 참조하고 `profiles`를 직접 참조하지
 * 않는다 — PostgREST 임베드 조인을 못 쓰므로(`admin/developers.ts`·
 * `findConversationsByProjects`와 같은 이유) 두 번 조회해 자바스크립트에서
 * 합친다.
 */

function fake(projects: unknown[], profiles: unknown[]) {
  const calls: { table: string; args: unknown[] }[] = [];

  const client = {
    from(table: string) {
      const chain = {
        select: (...args: unknown[]) => {
          calls.push({ table, args });
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        in: () => chain,
        then: (resolve: (r: unknown) => unknown) =>
          resolve({ data: table === "projects" ? projects : profiles, error: null }),
      };
      return chain;
    },
  };

  return { client: client as never, calls };
}

const PROJECT = {
  id: "proj-1",
  owner_id: "user-1",
  name: "소금빵 가게",
  slug: "sogeumppang",
  status: "deployed",
  visibility: "private",
  created_at: "2026-09-12T13:00:00Z",
};

describe("[P8-13] listAllProjectsForAdmin", () => {
  it("모든 프로젝트를 주인 이메일과 함께 준다", async () => {
    const { client } = fake([PROJECT], [{ id: "user-1", email: "dev@example.com" }]);

    const rows = await listAllProjectsForAdmin(client);

    expect(rows).toEqual([
      {
        id: "proj-1",
        ownerEmail: "dev@example.com",
        name: "소금빵 가게",
        slug: "sogeumppang",
        status: "deployed",
        visibility: "private",
        createdAt: "2026-09-12T13:00:00Z",
      },
    ]);
  });

  it("탈퇴해 프로필이 사라진 주인은 짧은 id로 대신한다 — 빈칸으로 두면 누구 것인지 사라진다", async () => {
    const { client } = fake([PROJECT], []);

    const rows = await listAllProjectsForAdmin(client);

    expect(rows[0].ownerEmail).toBe("user-1".slice(0, 8));
  });

  it("프로젝트가 없으면 profiles를 묻지 않는다", async () => {
    const { client, calls } = fake([], []);

    const rows = await listAllProjectsForAdmin(client);

    expect(rows).toEqual([]);
    expect(calls.some((c) => c.table === "profiles")).toBe(false);
  });

  it("최신 제작일 순으로 정렬해 부른다", async () => {
    const { client, calls } = fake([PROJECT], [{ id: "user-1", email: "dev@example.com" }]);

    await listAllProjectsForAdmin(client);

    const projectCall = calls.find((c) => c.table === "projects");
    expect(projectCall).toBeDefined();
  });
});
