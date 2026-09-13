import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";

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
const publishArtifact = vi.fn();
const recordUsage = vi.fn();
const loadAccountState = vi.fn();
const resolveAttachment = vi.fn();
const readAttachment = vi.fn();

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

vi.mock("@/lib/artifacts/publish", () => ({
  publishArtifact: (...args: unknown[]) => publishArtifact(...args),
}));

vi.mock("@/lib/usage/store", () => ({
  recordUsage: (...args: unknown[]) => recordUsage(...args),
}));

vi.mock("@/lib/billing/account", () => ({
  loadAccountState: (...args: unknown[]) => loadAccountState(...args),
}));

vi.mock("@/lib/attachments/store", () => ({
  resolveAttachment: (...args: unknown[]) => resolveAttachment(...args),
  readAttachment: (...args: unknown[]) => readAttachment(...args),
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
  publishArtifact.mockResolvedValue(null);
  recordUsage.mockResolvedValue(undefined);
  // 기본은 체험 기간 안 (앞으로 7일)
  loadAccountState.mockResolvedValue({
    grade: "trial",
    subscriptionStatus: "none",
    trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    monthlyTokensUsed: 0,
    projectCount: 0,
  });
  createChatStream.mockResolvedValue(streamOf({ type: "text", text: "네" }, { type: "done" }));
}

const VALID = { conversationId: "conv-1", message: "홈페이지 만들고 싶어" };

/**
 * 라우트 모듈을 미리 한 번 불러 둔다.
 *
 * 각 테스트가 본문에서 `await import`를 하므로 **첫 테스트가 모듈 그래프
 * 전체의 변환 비용을 혼자 뒤집어썼다**(기계가 바쁘면 5초 제한을 넘겼다).
 * 더 나쁜 것은 그 다음이다: 시간이 초과돼도 진행 중이던 호출은 계속 끝나서
 * **다음 테스트의 mock을 오염**시켜 2건이 연쇄로 깨졌다.
 */
beforeAll(async () => {
  await import("@/app/api/chat/route");
});

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

  it("[P3-6] 단계가 넘어갔으면 스트림 맨 앞에서 새 블록을 알려준다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "plan" });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request({ ...VALID, approved: true, message: "예" }));

    const events = await eventsOf(res);
    expect(events[0]).toEqual({ type: "block", block: "tasks" });
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

describe("[P4-3] POST /api/chat — 산출물 발행", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "implement" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("답변에 파일이 있으면 발행하고 artifact 이벤트로 알린다", async () => {
    createChatStream.mockResolvedValue(
      streamOf(
        { type: "text", text: "만들었습니다.\n```file:index.html\n<h1>안녕</h1>\n```" },
        { type: "done" },
      ),
    );
    publishArtifact.mockResolvedValue({
      project: { id: "proj-1", slug: "my-homepage", name: "내 홈페이지" },
      fileCount: 1,
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    const events = await eventsOf(res);

    expect(publishArtifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerId: "user-1", conversationId: "conv-1" }),
    );
    expect(events).toContainEqual({
      type: "artifact",
      slug: "my-homepage",
      fileCount: 1,
      // [P7-10]에서 넣은 이미지 수도 함께 온다
      imageCount: 0,
    });
  });

  it("파일이 없으면 artifact 이벤트를 보내지 않는다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    const events = await eventsOf(res);
    expect(events.some((e) => e.type === "artifact")).toBe(false);
  });

  it("발행에 실패해도 대화는 살리고 오류만 알린다", async () => {
    createChatStream.mockResolvedValue(
      streamOf({ type: "text", text: "```file:index.html\n<h1>x</h1>\n```" }, { type: "done" }),
    );
    publishArtifact.mockRejectedValue(new Error("quota exceeded"));

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    const events = await eventsOf(res);

    expect(res.status).toBe(200);
    expect(appendMessage).toHaveBeenCalledTimes(2); // 사용자 + AI 답변은 저장됨
    expect(events.some((e) => e.type === "error" && /quota exceeded/.test(e.message))).toBe(true);
  });
});

describe("[P4-5] POST /api/chat — 구현 단계 응답 길이", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function maxTokensOf() {
    return (createChatStream.mock.calls[0][0] as { maxTokens?: number }).maxTokens;
  }

  it("구현 단계는 파일을 통째로 써야 하므로 더 긴 답변을 허용한다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "implement" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request(VALID));

    expect(maxTokensOf()).toBeGreaterThanOrEqual(32000);
  });

  it("대화만 하는 단계는 기본 길이를 쓴다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(request(VALID));

    expect(maxTokensOf()).toBeLessThan(32000);
  });
});

describe("[P5-4b] POST /api/chat — 이미 만든 프로젝트 이어서 고치기", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("대화에 연결된 프로젝트가 있으면 '이미 만들어진 상태'로 알려준다", async () => {
    getConversation.mockResolvedValue({
      ...CONVERSATION,
      currentBlock: "implement",
      projectId: "proj-1",
    });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request(VALID));

    const { system } = createChatStream.mock.calls[0][0] as { system: string };
    expect(system).toContain("이미 만들어져");
  });

  it("아직 프로젝트가 없으면 그 안내를 넣지 않는다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "implement" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request(VALID));

    const { system } = createChatStream.mock.calls[0][0] as { system: string };
    expect(system).not.toContain("이미 만들어져");
  });
});

describe("[P6-2] POST /api/chat — 사용량 기록", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("Claude가 알려준 사용량을 기록하되 화면에는 보내지 않는다", async () => {
    createChatStream.mockResolvedValue(
      streamOf(
        { type: "text", text: "네" },
        { type: "usage", model: "claude-sonnet-5", inputTokens: 1234, outputTokens: 567 },
        { type: "done" },
      ),
    );

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    const events = await eventsOf(res);

    expect(events.some((e) => e.type === "usage")).toBe(false); // 사용자에게 흘리지 않는다
    expect(recordUsage).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      conversationId: "conv-1",
      projectId: null,
      model: "claude-sonnet-5",
      inputTokens: 1234,
      outputTokens: 567,
    });
  });

  it("사용량 기록이 실패해도 대화는 망가뜨리지 않는다", async () => {
    recordUsage.mockRejectedValue(new Error("db down"));
    createChatStream.mockResolvedValue(
      streamOf(
        { type: "text", text: "네" },
        { type: "usage", model: "claude-sonnet-5", inputTokens: 10, outputTokens: 20 },
        { type: "done" },
      ),
    );

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(200);
    expect((await eventsOf(res)).some((e) => e.type === "text")).toBe(true);
  });
});

describe("[P6-4] POST /api/chat — 체험·한도 차단", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("체험이 끝났으면 402로 막고 Claude를 부르지 않는다", async () => {
    loadAccountState.mockResolvedValue({
      grade: "trial",
      subscriptionStatus: "none",
      trialEndsAt: "2020-01-01T00:00:00Z",
      monthlyTokensUsed: 0,
      projectCount: 0,
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.reason).toBe("trial_expired");
    expect(body.error).toMatch(/체험/);
    expect(createChatStream).not.toHaveBeenCalled();
    // 막힌 요청은 메시지도 저장하지 않는다 (대화가 지저분해지면 안 된다)
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("이번 달 한도를 다 썼으면 402로 막고 업그레이드 대상을 알려준다", async () => {
    loadAccountState.mockResolvedValue({
      grade: "basic",
      subscriptionStatus: "active",
      trialEndsAt: null,
      monthlyTokensUsed: 2_000_000,
      projectCount: 0,
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "token_limit", upgradeTo: "pro" });
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("계정 정보를 못 읽으면 막는다 (fail-closed)", async () => {
    loadAccountState.mockResolvedValue(null);

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(402);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("체험 기간 안이면 그대로 진행한다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(200);
    expect(createChatStream).toHaveBeenCalled();
  });
});

/**
 * [P7-4b] 완성한 프로젝트도 계속 고칠 수 있어야 한다 (FR-029, BL-001).
 *
 * 사용자 신고: "이어서 수정"에 들어가면 "대화가 끝났습니다"만 뜨고
 * 프롬프트에 무엇을 넣어도 반응이 없었다. 구현을 마친 대화가 `done`이 되고
 * 이 라우트가 그것을 400으로 막고 있었기 때문이다.
 */
/**
 * [BL-014] 프로젝트 개수 한도가 집행되지 않았다.
 *
 * `canCreateProject`는 [P6-3]부터 있었지만 아무도 부르지 않았다 — 대시보드는
 * "프로젝트 0 / 1개"라고 알리면서 실제로는 무제한으로 만들 수 있었다.
 * 새 프로젝트를 **만들려는 순간**(구현 단계 + 아직 연결된 프로젝트 없음)에만
 * 막는다 — 이미 만든 프로젝트를 고치는 turn까지 막으면 안 된다.
 */
describe("[BL-014] 프로젝트 개수 한도", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    happyPath();
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "implement" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("한도를 다 쓴 채 새 프로젝트를 만들려 하면 402로 막고 Claude를 부르지 않는다", async () => {
    loadAccountState.mockResolvedValue({
      grade: "trial",
      subscriptionStatus: "none",
      trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      monthlyTokensUsed: 0,
      projectCount: 1, // 체험 한도(1개)를 이미 채움
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.reason).toBe("project_limit");
    expect(body.error).toMatch(/1개/);
    expect(createChatStream).not.toHaveBeenCalled();
    // 막힌 요청은 메시지도 저장하지 않는다 — canStartChat과 같은 원칙
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("이미 이 대화에 프로젝트가 연결돼 있으면(고치는 중) 한도를 다 썼어도 막지 않는다", async () => {
    getConversation.mockResolvedValue({
      ...CONVERSATION,
      currentBlock: "implement",
      projectId: "proj-existing",
    });
    loadAccountState.mockResolvedValue({
      grade: "trial",
      subscriptionStatus: "none",
      trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      monthlyTokensUsed: 0,
      projectCount: 1,
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(200);
    expect(createChatStream).toHaveBeenCalled();
  });

  it("구현 단계가 아니면(계획·작업분해 등) 한도를 다 썼어도 막지 않는다 — 아직 프로젝트를 만들지 않는다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "tasks" });
    loadAccountState.mockResolvedValue({
      grade: "trial",
      subscriptionStatus: "none",
      trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      monthlyTokensUsed: 0,
      projectCount: 1,
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(200);
    expect(createChatStream).toHaveBeenCalled();
  });

  it("한도 안이면 그대로 진행한다", async () => {
    loadAccountState.mockResolvedValue({
      grade: "trial",
      subscriptionStatus: "none",
      trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      monthlyTokensUsed: 0,
      projectCount: 0,
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect(res.status).toBe(200);
    expect(createChatStream).toHaveBeenCalled();
  });

  it("한도를 넘겨도 업그레이드할 등급이 있으면 알려준다", async () => {
    loadAccountState.mockResolvedValue({
      grade: "trial",
      subscriptionStatus: "none",
      trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      monthlyTokensUsed: 0,
      projectCount: 1,
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));

    expect((await res.json()).upgradeTo).toBe("basic");
  });
});

describe("[P7-4b] 구현을 마친 대화도 계속 받는다", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    happyPath();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("예전에 done으로 굳은 대화에 메시지를 보내면 막지 않는다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "done" });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      request({ conversationId: "conv-1", message: "제목 글자를 키워줘" }),
    );

    expect(res.status).toBe(200);
    expect(createChatStream).toHaveBeenCalled();
  });

  it("done인 대화는 유지보수 지시로 말을 건다 (헌장부터 다시 묻지 않는다)", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "done" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ conversationId: "conv-1", message: "버튼 색을 바꿔줘" }));

    const { system } = createChatStream.mock.calls[0][0] as { system: string };
    expect(system).toContain("고칠 파일만");
    expect(system).not.toContain("헌장(Constitution)을 고르게");
  });

  it("구현 단계에서 승인하면 done이 아니라 유지보수로 저장한다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "implement" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(
      request({ conversationId: "conv-1", message: "네, 좋아요", approved: true }),
    );

    expect(setCurrentBlock).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      "user-1",
      "maintenance",
    );
  });

  it("유지보수 중에는 몇 번을 더 보내도 계속 받는다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "maintenance" });
    // 스트림은 한 번만 읽을 수 있으므로 호출마다 새로 만든다
    createChatStream.mockImplementation(async () =>
      streamOf({ type: "text", text: "고쳤습니다" }, { type: "done" }),
    );

    const { POST } = await import("@/app/api/chat/route");
    for (const message of ["글자 키워줘", "색도 바꿔줘", "사진 자리 만들어줘"]) {
      const res = await POST(request({ conversationId: "conv-1", message }));
      expect(res.status, message).toBe(200);
    }
  });

  it("유지보수 중에는 구현 단계와 같은 긴 답변 길이를 쓴다 (파일을 다시 내야 하므로)", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, currentBlock: "maintenance" });

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ conversationId: "conv-1", message: "index.html 고쳐줘" }));

    const { maxTokens } = createChatStream.mock.calls[0][0] as { maxTokens: number };
    expect(maxTokens).toBe(32_000);
  });
});

/**
 * [P7-1b] 이름을 안 적은 사람에게는 첫 요청에서 지어준다 (FR-030, BL-002).
 * 모델을 한 번 더 부르지 않는다 — 이름 짓자고 돈을 쓸 이유가 없다.
 */
describe("[P7-1b] 프로젝트 자동 이름", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    happyPath();
    createChatStream.mockResolvedValue(
      streamOf({ type: "text", text: "```file:index.html\n<h1>x</h1>\n```" }, { type: "done" }),
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("제목이 없으면 첫 요청 내용으로 프로젝트 이름을 짓는다", async () => {
    getConversation.mockResolvedValue({ ...CONVERSATION, title: null, currentBlock: "implement" });
    listMessages.mockResolvedValue([{ role: "user", content: "빵집 홈페이지 만들고 싶어" }]);

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request({ conversationId: "conv-1", message: "네 좋아요" }));
    await res.text();

    expect(publishArtifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectName: "빵집 홈페이지" }),
    );
  });

  it("제목을 정해둔 사람의 이름은 건드리지 않는다", async () => {
    getConversation.mockResolvedValue({
      ...CONVERSATION,
      title: "소금빵 가게",
      currentBlock: "implement",
    });
    listMessages.mockResolvedValue([{ role: "user", content: "빵집 홈페이지 만들고 싶어" }]);

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request({ conversationId: "conv-1", message: "네 좋아요" }));
    await res.text();

    expect(publishArtifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectName: "소금빵 가게" }),
    );
  });
});

/**
 * [P7-9] 첨부를 모델에게 실어 보낸다 (FR-031, BL-004).
 *
 * 클라이언트는 **id만** 보낸다. 서버가 그 id로 저장소에서 원본을 다시 읽는다 —
 * 클라이언트가 보낸 파일 내용을 그대로 모델에게 넘기면, 화면에 보여준 것과
 * 다른 것을 보낼 수 있다.
 */
describe("[P7-9] 첨부 전달", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    happyPath();
    resolveAttachment.mockImplementation(async (_admin, { id }) =>
      id === "att-img"
        ? {
            ownerId: "user-1",
            conversationId: "conv-1",
            id,
            extension: "png",
            kind: "image",
            mediaType: "image/png",
          }
        : id === "att-txt"
          ? {
              ownerId: "user-1",
              conversationId: "conv-1",
              id,
              extension: "md",
              kind: "text",
              mediaType: "text/markdown",
            }
          : null,
    );
    readAttachment.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("이미지 첨부를 image 블록으로 싣는다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ ...VALID, attachmentIds: ["att-img"] }));

    const { messages } = createChatStream.mock.calls[0][0] as {
      messages: { role: string; content: unknown }[];
    };
    const last = messages[messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toContainEqual(
      expect.objectContaining({
        type: "image",
        source: expect.objectContaining({ type: "base64", media_type: "image/png" }),
      }),
    );
  });

  it("글파일 첨부는 첨부임을 밝히고 내용을 싣는다", async () => {
    readAttachment.mockResolvedValue(new TextEncoder().encode("# 기획서\n메뉴 3개"));

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ ...VALID, attachmentIds: ["att-txt"] }));

    const { messages } = createChatStream.mock.calls[0][0] as {
      messages: { role: string; content: { type: string; text?: string }[] }[];
    };
    const blocks = messages[messages.length - 1].content;
    const texts = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "");
    expect(texts.some((t) => t.includes("# 기획서"))).toBe(true);
    expect(texts.some((t) => t.includes("첨부한 글파일"))).toBe(true);
  });

  it("사용자가 쓴 메시지도 함께 실린다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ ...VALID, attachmentIds: ["att-img"] }));

    const { messages } = createChatStream.mock.calls[0][0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const blocks = messages[messages.length - 1].content;
    expect(blocks.some((b) => b.type === "text" && b.text?.includes(VALID.message))).toBe(true);
  });

  it("첨부가 없으면 예전처럼 글자만 보낸다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(request(VALID));

    const { messages } = createChatStream.mock.calls[0][0] as {
      messages: { content: unknown }[];
    };
    expect(messages[messages.length - 1].content).toBe(VALID.message);
    expect(readAttachment).not.toHaveBeenCalled();
  });

  it("내 것이 아닌 첨부 id는 400 — Claude를 부르지 않는다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request({ ...VALID, attachmentIds: ["남의것"] }));

    expect(res.status).toBe(400);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("6개를 붙이면 400", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      request({ ...VALID, attachmentIds: ["att-img", "att-img", "att-img", "att-img", "att-img", "att-img"] }),
    );

    expect(res.status).toBe(400);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("아주 긴 글파일은 잘라서 싣고, 잘랐다고 알린다", async () => {
    readAttachment.mockResolvedValue(new TextEncoder().encode("가".repeat(200_000)));

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ ...VALID, attachmentIds: ["att-txt"] }));

    const { messages } = createChatStream.mock.calls[0][0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const joined = messages[messages.length - 1].content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    expect(joined.length).toBeLessThan(150_000);
    expect(joined).toContain("잘렸");
  });

  it("첨부가 있어도 사용량은 그대로 기록된다 (같은 월 한도)", async () => {
    createChatStream.mockResolvedValue(
      streamOf(
        { type: "usage", model: "claude-sonnet-5", inputTokens: 4000, outputTokens: 100 },
        { type: "done" },
      ),
    );

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request({ ...VALID, attachmentIds: ["att-img"] }));
    await res.text();

    expect(recordUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inputTokens: 4000, model: "claude-sonnet-5" }),
    );
  });
});

/**
 * [P7-10] 이미지를 넣었는지, 못 넣었는지 화면에 알린다 (FR-032, BL-005).
 */
describe("[P7-10] 산출물 이미지 알림", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    happyPath();
    createChatStream.mockResolvedValue(
      streamOf({ type: "text", text: "사진을 넣었습니다." }, { type: "done" }),
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("넣은 이미지 수를 산출물 알림에 함께 보낸다", async () => {
    publishArtifact.mockResolvedValue({
      project: { slug: "site-abc" },
      fileCount: 2,
      imageCount: 1,
      warnings: [],
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    const events = await eventsOf(res);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "artifact", slug: "site-abc", fileCount: 2, imageCount: 1 }),
    );
  });

  it("못 넣은 이미지는 조용히 넘어가지 않고 알린다", async () => {
    publishArtifact.mockResolvedValue({
      project: { slug: "site-abc" },
      fileCount: 1,
      imageCount: 0,
      warnings: ["images/hero.png (첨부를 찾을 수 없습니다.)"],
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request(VALID));
    const events = await eventsOf(res);

    const notice = events.find((e) => e.type === "error");
    expect(notice?.message).toContain("images/hero.png");
  });

  it("첨부 id를 프롬프트로 알려준다 (모델이 그 id로 지시를 쓴다)", async () => {
    resolveAttachment.mockResolvedValue({
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-img",
      extension: "png",
      kind: "image",
      mediaType: "image/png",
    });
    readAttachment.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ ...VALID, attachmentIds: ["att-img"] }));

    const { system } = createChatStream.mock.calls[0][0] as { system: string };
    expect(system).toContain("att-img");
    expect(system).toContain("use-image:");
  });
});
