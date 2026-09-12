import { describe, expect, it, vi } from "vitest";
import { ensureProfile } from "@/lib/auth/profile";

/**
 * [BL-016] 프로필이 없는 계정을 스스로 고친다 (FR-021).
 *
 * 가입자 2명에게 `profiles` 행이 없어 대화가 402로 막혔고, **운영 콘솔
 * 목록에도 보이지 않았다** — 목록이 `profiles`에서 오기 때문이다.
 * 드러날 길이 없다는 것이 이 결함의 본질이었다.
 *
 * 트리거는 지금 정상이지만, 되풀이되면 또 조용하다. 사람이 알아채기를
 * 기다리는 대신 **로그인할 때 스스로 낫게** 한다 — `ensureAdminRole`을
 * 로그인에 배선한 것([BL-008])과 같은 자리, 같은 이유다.
 */

interface Call {
  op: string;
  args: unknown[];
}

function fakeAdmin({
  existing,
  insertError,
  selectError,
}: {
  existing?: { id: string } | null;
  insertError?: { message: string };
  selectError?: { message: string };
} = {}) {
  const calls: Call[] = [];

  const client = {
    from(table: string) {
      calls.push({ op: "from", args: [table] });
      const chain = {
        select: () => chain,
        eq: () => chain,
        async maybeSingle() {
          return { data: existing ?? null, error: selectError ?? null };
        },
        async insert(row: Record<string, unknown>) {
          calls.push({ op: "insert", args: [row] });
          return { error: insertError ?? null };
        },
      };
      return chain;
    },
  };

  return { client: client as never, calls };
}

const inserted = (calls: Call[]) =>
  calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown> | undefined;

describe("[BL-016] ensureProfile", () => {
  it("프로필이 없으면 만든다", async () => {
    const { client, calls } = fakeAdmin({ existing: null });

    const result = await ensureProfile(client, "user-1", "dev@example.com");

    expect(result).toEqual({ created: true });
    expect(inserted(calls)).toMatchObject({ id: "user-1", email: "dev@example.com" });
  });

  it("이미 있으면 건드리지 않는다 — 등급·체험 기간을 덮어쓰면 안 된다", async () => {
    const { client, calls } = fakeAdmin({ existing: { id: "user-1" } });

    const result = await ensureProfile(client, "user-1", "dev@example.com");

    expect(result).toEqual({ created: false });
    expect(inserted(calls)).toBeUndefined();
  });

  it("나머지 값은 DB 기본값에 맡긴다 — 체험 7일 계산을 두 군데 두지 않는다", async () => {
    const { client, calls } = fakeAdmin({ existing: null });
    await ensureProfile(client, "user-1", "dev@example.com");

    expect(Object.keys(inserted(calls) ?? {}).sort()).toEqual(["email", "id"]);
  });

  it("이메일을 모르면 만들지 않는다 — 누구인지 모르는 행을 남기지 않는다", async () => {
    const { client, calls } = fakeAdmin({ existing: null });

    const result = await ensureProfile(client, "user-1", null);

    expect(result).toEqual({ created: false, reason: expect.any(String) });
    expect(inserted(calls)).toBeUndefined();
  });

  it("만들다 실패해도 던지지 않는다 — 로그인을 막으면 안 된다", async () => {
    const { client } = fakeAdmin({ existing: null, insertError: { message: "권한 없음" } });

    const result = await ensureProfile(client, "user-1", "dev@example.com");

    expect(result).toMatchObject({ created: false });
    expect((result as { reason: string }).reason).toContain("권한 없음");
  });

  it("조회가 실패하면 만들지 않는다 — 있는지 모르는 채로 넣으면 덮어쓸 수 있다", async () => {
    const { client, calls } = fakeAdmin({ selectError: { message: "연결 끊김" } });

    const result = await ensureProfile(client, "user-1", "dev@example.com");

    expect(result).toMatchObject({ created: false });
    expect(inserted(calls)).toBeUndefined();
  });

  it("동시에 두 번 들어와 중복이 나도 조용히 넘긴다 (이미 있는 것이니 목적은 이뤄졌다)", async () => {
    const { client } = fakeAdmin({
      existing: null,
      insertError: { message: 'duplicate key value violates unique constraint "profiles_pkey"' },
    });

    const result = await ensureProfile(client, "user-1", "dev@example.com");

    expect(result).toEqual({ created: false });
  });
});

describe("[BL-016] 예기치 못한 오류", () => {
  it("클라이언트가 통째로 터져도 던지지 않는다", async () => {
    const exploding = {
      from() {
        throw new Error("클라이언트 고장");
      },
    } as never;

    await expect(ensureProfile(exploding, "user-1", "dev@example.com")).resolves.toMatchObject({
      created: false,
    });
  });
});

describe("[BL-016] 정상 경로에서는 조용하다", () => {
  it("여러 번 불러도 한 번만 만든다", async () => {
    let existing: { id: string } | null = null;
    const client = {
      from() {
        const chain = {
          select: () => chain,
          eq: () => chain,
          async maybeSingle() {
            return { data: existing, error: null };
          },
          async insert() {
            existing = { id: "user-1" };
            return { error: null };
          },
        };
        return chain;
      },
    } as never;

    expect(await ensureProfile(client, "user-1", "dev@example.com")).toEqual({ created: true });
    expect(await ensureProfile(client, "user-1", "dev@example.com")).toEqual({ created: false });
  });
});

// 위 vi 사용 경고 방지 (mock을 쓰지 않는 파일이므로)
void vi;
