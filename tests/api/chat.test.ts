import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * POST /api/chat 라우트 테스트.
 *
 * [P3-2] 인증·입력검증·환경변수 확인·스트림 반환
 * [P3-3] 현재 블록의 진행대본을 system 프롬프트로 전달
 * [P3-4] 대화 기록을 DB에서 읽고 쓰기 — 클라이언트는 대화 ID와 이번 메시지만 보낸다
 */

const getUser = vi.fn();
const createChatStream = vi.fn();
const getConversation = vi.fn();
const listMessages = vi.fn();
const appendMessage = vi.fn();
const setCurrentBlock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/claude/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude/chat")>()),
  createChatStream: (...args: unknown[]) => createChatStream(...args),
}));

vi.mock("@/lib/conversations/store", () => ({
  getConversation: (...args: unknown[]) => getConversation(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  appendMessage: (...args: unknown[]) => appendMessage(...args),
  setCurrentBlock: (...args: unknown[]) => setCurrentBlock(...args),
}));

function request(body: unknown) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** createChatStream이 돌려줄 NDJSON 스트림을 만든다. */
function streamOf(...events: unknown[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      controller.close();
    },
  });
}

async function eventsOf(res: Response) {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

const CONVERSATION = { id: "conv-1", ownerId: "user-1", currentBlock: "clarify" as const };

function happyPath() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  getConversation.mockResolvedValue(CONVERSATION);
  listMessages.mockResolvedValue([]);
  appendMessage.mockResolvedValue(undefined);
  setCurrentBlock.mockResolvedValue(undefined);
  createChatStream.mockResolvedValue(streamOf({ type: "text", text: "네" }, { type: "done" }));
}

const VALID = { conversationId: "conv-1", message: "홈페이지 만들고 싶어" };

describe("[P3-2] POST /api/chat — 접근 통제와 입력 검증", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("로그인하지 않으면 401을 반환하고 Claude를 부르지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(401);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("대화 ID나 메시지가 없으면 400을 반환한다", async () => {
    const { POST } = await import("@/app/api/chat/route");

    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ conversationId: "conv-1" }))).status).toBe(400);
    expect((await POST(request({ conversationId: "conv-1", message: "   " }))).status).toBe(400);
    expect((await POST(request({ message: "안녕" }))).status).toBe(400);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("내 대화가 아니면 404를 반환한다", async () => {
    getConversation.mockResolvedValue(null);

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(404);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("서버에 ANTHROPIC_API_KEY가 없으면 500을 반환한다 (키 값은 응답에 없음)", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("test-key");
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("정상 요청이면 NDJSON 스트림을 흘려보낸다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await eventsOf(res)).toEqual([{ type: "text", text: "네" }, { type: "done" }]);
  });
});

describe("[P3-3] POST /api/chat — 진행대본 프롬프트", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function systemOf() {
    return (createChatStream.mock.calls[0][0] as { system?: string }).system ?? "";
  }

  it("진행 단계는 클라이언트가 아니라 DB에 저장된 블록에서 가져온다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    // 클라이언트가 블록을 끼워넣어도 무시해야 한다.
    await POST(request({ ...VALID, block: "implement" }));

    expect(systemOf()).toContain("현재 블록: 블록 2"); // 대화에 저장된 clarify
    expect(systemOf()).not.toContain("현재 블록: 블록 5");
  });

  it("대화 제목이 있으면 프롬프트에 프로젝트 이름으로 넣는다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, title: "독서기록 앱" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request(VALID));

    expect(systemOf()).toContain("독서기록 앱");
  });
});

describe("[P3-4] POST /api/chat — 대화 상태 저장", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("이전 대화 기록을 DB에서 읽어 이번 메시지 뒤에 붙여 보낸다", async () => {
    listMessages.mockResolvedValue([
      { role: "user", content: "홈페이지 만들고 싶어" },
      { role: "assistant", content: "어떤 화면이 필요하세요?" },
    ]);

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ conversationId: "conv-1", message: "3개요" }));

    const { messages } = createChatStream.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    expect(messages).toEqual([
      { role: "user", content: "홈페이지 만들고 싶어" },
      { role: "assistant", content: "어떤 화면이 필요하세요?" },
      { role: "user", content: "3개요" },
    ]);
  });

  it("사용자 메시지는 Claude를 부르기 전에 저장한다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(request(VALID));

    expect(appendMessage).toHaveBeenCalledWith(expect.anything(), {
      conversationId: "conv-1",
      role: "user",
      content: "홈페이지 만들고 싶어",
    });
  });

  it("스트림이 끝나면 AI 답변도 저장한다", async () => {
    createChatStream.mockResolvedValue(
      streamOf({ type: "text", text: "안녕" }, { type: "text", text: "하세요" }, { type: "done" }),
    );

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    await res.text(); // 스트림을 끝까지 읽어야 저장이 일어난다

    expect(appendMessage).toHaveBeenCalledWith(expect.anything(), {
      conversationId: "conv-1",
      role: "assistant",
      content: "안녕하세요",
    });
  });

  it("답변이 비어 있으면(오류 등) 빈 메시지를 저장하지 않는다", async () => {
    createChatStream.mockResolvedValue(streamOf({ type: "error", message: "호출 실패" }));

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    await res.text();

    expect(appendMessage).toHaveBeenCalledTimes(1); // 사용자 메시지만
  });

  it("게이트 마커가 나오면 gate 이벤트로 알리고, 마커는 화면에도 DB에도 남기지 않는다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "plan" });
    createChatStream.mockResolvedValue(
      streamOf(
        { type: "text", text: "이 계획대로 진행할까요?\n" },
        { type: "text", text: "<<SDVC_GATE:" },
        { type: "text", text: "plan>>" },
        { type: "done" },
      ),
    );

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    const events = await eventsOf(res);

    const shown = events
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join("");
    expect(shown).not.toContain("SDVC_GATE");
    expect(events).toContainEqual({ type: "gate", block: "plan" });

    expect(appendMessage).toHaveBeenLastCalledWith(expect.anything(), {
      conversationId: "conv-1",
      role: "assistant",
      content: "이 계획대로 진행할까요?",
    });
  });

  it("승인하면 다음 블록으로 옮기고 그 블록의 대본으로 진행한다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "plan" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ ...VALID, approved: true, message: "예, 이대로 진행" }));

    expect(setCurrentBlock).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      "user-1",
      "tasks",
    );
    const { system } = createChatStream.mock.calls[0][0] as { system: string };
    expect(system).toContain("현재 블록: 블록 4");
  });

  it("승인하지 않으면 게이트 블록에 그대로 머문다 (fail-closed)", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "plan" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ ...VALID, message: "React로 바꿔주세요" }));

    expect(setCurrentBlock).not.toHaveBeenCalled();
    const { system } = createChatStream.mock.calls[0][0] as { system: string };
    expect(system).toContain("현재 블록: 블록 3");
  });
});
