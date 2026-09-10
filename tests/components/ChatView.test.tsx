import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatView } from "@/components/chat/ChatView";

/**
 * [P3-5] 채팅 화면 — 스트리밍 표시.
 * 서버가 흘려보내는 NDJSON 이벤트(text/thinking/gate/done)를 화면이
 * 어떻게 보여주는지 검증한다.
 */

/** /api/chat 응답처럼 NDJSON을 흘려보내는 가짜 fetch를 만든다. */
function mockChatResponse(...events: unknown[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

describe("[P3-5] ChatView", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("이미 나눈 대화를 순서대로 보여준다", () => {
    render(
      <ChatView
        conversationId="conv-1"
        currentBlock="clarify"
        initialMessages={[
          { role: "user", content: "홈페이지 만들고 싶어" },
          { role: "assistant", content: "어떤 화면이 필요하세요?" },
        ]}
      />,
    );

    expect(screen.getByText("홈페이지 만들고 싶어")).toBeInTheDocument();
    expect(screen.getByText("어떤 화면이 필요하세요?")).toBeInTheDocument();
  });

  it("지금 어느 단계인지 보여준다", () => {
    render(<ChatView conversationId="conv-1" currentBlock="plan" initialMessages={[]} />);

    expect(screen.getByText(/블록 3/)).toBeInTheDocument();
    expect(screen.getByText(/계획/)).toBeInTheDocument();
  });

  it("메시지를 보내면 /api/chat을 부르고 답변이 조금씩 화면에 붙는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockChatResponse(
        { type: "text", text: "안녕" },
        { type: "text", text: "하세요" },
        { type: "done" },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />,
    );

    await userEvent.type(screen.getByLabelText("메시지"), "홈페이지 만들고 싶어");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    // 내가 쓴 말은 바로 화면에 남는다
    expect(screen.getByText("홈페이지 만들고 싶어")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("안녕하세요")).toBeInTheDocument());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(init.body)).toEqual({
      conversationId: "conv-1",
      message: "홈페이지 만들고 싶어",
    });
  });

  it("모델이 생각하는 동안에는 '생각하는 중'을 보여준다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('{"type":"thinking"}\n'));
              await gate;
              controller.enqueue(encoder.encode('{"type":"text","text":"계획입니다"}\n'));
              controller.enqueue(encoder.encode('{"type":"done"}\n'));
              controller.close();
            },
          }),
        ),
      ),
    );

    render(<ChatView conversationId="conv-1" currentBlock="plan" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "계획 세워줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/생각하는 중/)).toBeInTheDocument());

    release();
    await waitFor(() => expect(screen.getByText("계획입니다")).toBeInTheDocument());
    expect(screen.queryByText(/생각하는 중/)).not.toBeInTheDocument();
  });

  it("답장을 기다리는 동안에는 다시 보내지 못하게 막는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              /* 끝나지 않는 스트림 */
            },
          }),
        ),
      ),
    );

    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /보내는 중/ })).toBeDisabled(),
    );
  });

  it("오류가 나면 화면에 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockChatResponse({ type: "error", message: "호출 실패" })),
    );

    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/호출 실패/)).toBeInTheDocument());
  });
});
