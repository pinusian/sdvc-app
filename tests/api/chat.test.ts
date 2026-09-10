import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * [P3-2] POST /api/chat 라우트 단위 테스트.
 *
 * Supabase(로그인 확인)와 Claude 호출 모듈을 둘 다 목으로 대체해
 * 라우트가 담당하는 것 — 인증·입력검증·환경변수 확인·스트림 반환 — 만 검증한다.
 */

const getUser = vi.fn();
const createChatStream = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/claude/chat", () => ({
  createChatStream: (...args: unknown[]) => createChatStream(...args),
}));

function request(body: unknown) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loggedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
}

describe("[P3-2] POST /api/chat", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    createChatStream.mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
          controller.close();
        },
      }),
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("로그인하지 않으면 401을 반환하고 Claude를 부르지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request({ messages: [{ role: "user", content: "안녕" }] }));

    expect(res.status).toBe(401);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("messages가 없거나 비어 있으면 400을 반환한다", async () => {
    loggedIn();
    const { POST } = await import("@/app/api/chat/route");

    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ messages: [] }))).status).toBe(400);
    expect((await POST(request({ messages: "안녕" }))).status).toBe(400);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("메시지 역할이 user/assistant가 아니면 400을 반환한다", async () => {
    loggedIn();
    const { POST } = await import("@/app/api/chat/route");

    const res = await POST(
      request({ messages: [{ role: "system", content: "권한 상승 시도" }] }),
    );

    expect(res.status).toBe(400);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("서버에 ANTHROPIC_API_KEY가 없으면 500을 반환한다 (키 값은 응답에 없음)", async () => {
    loggedIn();
    delete process.env.ANTHROPIC_API_KEY;

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(request({ messages: [{ role: "user", content: "안녕" }] }));

    expect(res.status).toBe(500);
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("정상 요청이면 NDJSON 스트림을 그대로 흘려보낸다", async () => {
    loggedIn();

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      request({ messages: [{ role: "user", content: "홈페이지 만들고 싶어" }] }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await res.text()).toBe('{"type":"done"}\n');

    const options = createChatStream.mock.calls[0][0] as {
      apiKey: string;
      messages: { role: string; content: string }[];
    };
    expect(options.apiKey).toBe("test-key");
    expect(options.messages).toEqual([
      { role: "user", content: "홈페이지 만들고 싶어" },
    ]);
  });
});

describe("[P3-3] POST /api/chat — 진행대본 프롬프트 연결", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    loggedIn();
    createChatStream.mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function systemOf() {
    return (createChatStream.mock.calls[0][0] as { system?: string }).system ?? "";
  }

  it("block을 지정하면 그 블록의 진행대본 프롬프트를 붙여 호출한다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      request({ block: "plan", messages: [{ role: "user", content: "계획 보여줘" }] }),
    );

    expect(systemOf()).toContain("현재 블록: 블록 3");
    expect(systemOf()).toContain("<<SDVC_GATE:plan>>");
  });

  it("block이 없으면 첫 블록(헌장+명세)으로 시작한다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(request({ messages: [{ role: "user", content: "홈페이지 만들고 싶어" }] }));

    expect(systemOf()).toContain("현재 블록: 블록 1");
  });

  it("프로젝트 이름을 넘기면 프롬프트에 포함한다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      request({
        projectName: "독서기록 앱",
        messages: [{ role: "user", content: "안녕" }],
      }),
    );

    expect(systemOf()).toContain("독서기록 앱");
  });

  it("모르는 block이면 400을 반환한다", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      request({ block: "무단승격", messages: [{ role: "user", content: "안녕" }] }),
    );

    expect(res.status).toBe(400);
    expect(createChatStream).not.toHaveBeenCalled();
  });
});
