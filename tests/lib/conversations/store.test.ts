import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
  setCurrentBlock,
  findConversationsByProjects,
} from "@/lib/conversations/store";

/**
 * [P3-4] 대화 상태 저장소 단위 테스트.
 *
 * Supabase 클라이언트를 주입받으므로([P2-5]와 같은 구조) 실제 DB 없이
 * 호출 형태를 검증한다. 실제 DB 동작은 마이그레이션 실행 후
 * 실계정 검증으로 따로 확인한다.
 */

type Result = { data: unknown; error: unknown };

/** Supabase 쿼리 빌더 중 우리가 쓰는 부분만 흉내낸 가짜. */
function fakeSupabase(result: Result = { data: null, error: null }) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args.length === 1 ? args[0] : args);
  };

  const builder: Record<string, unknown> = {};
  for (const name of ["insert", "select", "update", "eq", "in", "order", "limit"]) {
    builder[name] = (...args: unknown[]) => {
      record(name, ...args);
      return builder;
    };
  }
  builder.single = () => {
    record("single");
    return Promise.resolve(result);
  };
  builder.maybeSingle = () => {
    record("maybeSingle");
    return Promise.resolve(result);
  };
  // await client.from(...).select(...).eq(...) 처럼 single 없이 끝나는 경우
  builder.then = (resolve: (value: Result) => unknown) => resolve(result);

  const client = {
    from: (table: string) => {
      record("from", table);
      return builder;
    },
  };

  return { client: client as never, calls };
}

describe("[P3-4] 대화 상태 저장소", () => {
  beforeEach(() => vi.clearAllMocks());

  it("대화를 만들면 소유자와 첫 블록이 함께 저장된다", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "conv-1", owner_id: "user-1", current_block: "constitution_specify" },
      error: null,
    });

    const conversation = await createConversation(client, {
      ownerId: "user-1",
      title: "독서기록 앱",
    });

    expect(calls.from).toContain("conversations");
    expect(calls.insert[0]).toMatchObject({
      owner_id: "user-1",
      title: "독서기록 앱",
      current_block: "constitution_specify",
    });
    expect(conversation).toEqual({
      id: "conv-1",
      ownerId: "user-1",
      currentBlock: "constitution_specify",
      title: null,
      projectId: null,
    });
  });

  it("대화 조회는 소유자 조건을 함께 걸어 남의 대화를 못 보게 한다", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "conv-1", owner_id: "user-1", current_block: "plan" },
      error: null,
    });

    const conversation = await getConversation(client, "conv-1", "user-1");

    expect(calls.eq).toContainEqual(["id", "conv-1"]);
    expect(calls.eq).toContainEqual(["owner_id", "user-1"]);
    expect(conversation?.currentBlock).toBe("plan");
  });

  it("[P4-3] 제목과 연결된 프로젝트도 함께 읽어온다", async () => {
    // 제목은 프롬프트의 프로젝트 이름으로, project_id는 산출물을 다시 낼 때
    // 새 프로젝트를 또 만들지 않기 위해 필요하다. 읽어오지 않으면 조용히
    // 매번 새 프로젝트가 생긴다.
    const { client, calls } = fakeSupabase({
      data: {
        id: "conv-1",
        owner_id: "user-1",
        current_block: "implement",
        title: "독서기록 앱",
        project_id: "proj-1",
      },
      error: null,
    });

    const conversation = await getConversation(client, "conv-1", "user-1");

    expect(String(calls.select[0])).toContain("title");
    expect(String(calls.select[0])).toContain("project_id");
    expect(conversation).toMatchObject({ title: "독서기록 앱", projectId: "proj-1" });
  });

  it("[P4-3] 제목·프로젝트가 아직 없으면 null로 준다", async () => {
    const { client } = fakeSupabase({
      data: { id: "conv-1", owner_id: "user-1", current_block: "clarify", title: null, project_id: null },
      error: null,
    });

    const conversation = await getConversation(client, "conv-1", "user-1");
    expect(conversation?.title).toBeNull();
    expect(conversation?.projectId).toBeNull();
  });

  it("없는 대화(또는 남의 대화)를 조회하면 null을 준다", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await getConversation(client, "conv-x", "user-1")).toBeNull();
  });

  it("메시지를 추가하면 역할과 내용이 저장된다", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "msg-1", role: "user", content: "홈페이지 만들고 싶어" },
      error: null,
    });

    await appendMessage(client, {
      conversationId: "conv-1",
      role: "user",
      content: "홈페이지 만들고 싶어",
    });

    expect(calls.from).toContain("messages");
    expect(calls.insert[0]).toMatchObject({
      conversation_id: "conv-1",
      role: "user",
      content: "홈페이지 만들고 싶어",
    });
  });

  it("빈 메시지는 저장하지 않고 거부한다", async () => {
    const { client, calls } = fakeSupabase();

    await expect(
      appendMessage(client, { conversationId: "conv-1", role: "user", content: "   " }),
    ).rejects.toThrow();
    expect(calls.insert).toBeUndefined();
  });

  it("메시지 목록은 시간 순으로 불러오고 대화 형식으로 바꿔준다", async () => {
    const { client, calls } = fakeSupabase({
      data: [
        { role: "user", content: "홈페이지 만들고 싶어" },
        { role: "assistant", content: "어떤 화면이 필요하세요?" },
      ],
      error: null,
    });

    const messages = await listMessages(client, "conv-1");

    expect(calls.order).toContainEqual(["created_at", { ascending: true }]);
    expect(messages).toEqual([
      { role: "user", content: "홈페이지 만들고 싶어" },
      { role: "assistant", content: "어떤 화면이 필요하세요?" },
    ]);
  });

  it("현재 블록을 옮길 때도 소유자 조건을 건다", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "conv-1", owner_id: "user-1", current_block: "tasks" },
      error: null,
    });

    await setCurrentBlock(client, "conv-1", "user-1", "tasks");

    expect(calls.update[0]).toMatchObject({ current_block: "tasks" });
    expect(calls.eq).toContainEqual(["owner_id", "user-1"]);
  });

  it("DB 오류는 삼키지 않고 그대로 알린다", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "permission denied" } });

    await expect(createConversation(client, { ownerId: "user-1" })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("[P5-4b] 프로젝트로 대화 찾기 (FR-025)", () => {
  it("프로젝트 id들로 그 프로젝트를 만든 대화를 찾아준다", async () => {
    const { client, calls } = fakeSupabase({
      data: [
        { id: "conv-1", project_id: "proj-1" },
        { id: "conv-2", project_id: "proj-2" },
      ],
      error: null,
    });

    const map = await findConversationsByProjects(client, ["proj-1", "proj-2"], "user-1");

    expect(calls.eq).toContainEqual(["owner_id", "user-1"]);
    expect(map).toEqual({ "proj-1": "conv-1", "proj-2": "conv-2" });
  });

  it("빈 목록이면 DB를 부르지 않는다", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });

    expect(await findConversationsByProjects(client, [], "user-1")).toEqual({});
    expect(calls.from).toBeUndefined();
  });
});
