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

describe("[P3-6] ChatView — 승인 게이트", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  async function sendAndReachGate(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView conversationId="conv-1" currentBlock="plan" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "계획 세워줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /예, 이대로 진행/ })).toBeInTheDocument(),
    );
  }

  it("gate 이벤트를 받으면 승인 버튼을 보여준다", async () => {
    await sendAndReachGate(
      vi.fn().mockResolvedValue(
        mockChatResponse(
          { type: "text", text: "이 계획대로 진행할까요?" },
          { type: "gate", block: "plan" },
          { type: "done" },
        ),
      ),
    );

    expect(screen.getByRole("button", { name: /예, 이대로 진행/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /수정할 게 있어요/ })).toBeInTheDocument();
  });

  it("승인을 누르면 approved:true로 다시 요청하고 버튼은 사라진다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockChatResponse(
          { type: "text", text: "이 계획대로 진행할까요?" },
          { type: "gate", block: "plan" },
          { type: "done" },
        ),
      )
      .mockResolvedValueOnce(
        mockChatResponse(
          { type: "block", block: "tasks" },
          { type: "text", text: "작업을 나눠보겠습니다" },
          { type: "done" },
        ),
      );

    await sendAndReachGate(fetchMock);
    await userEvent.click(screen.getByRole("button", { name: /예, 이대로 진행/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      conversationId: "conv-1",
      approved: true,
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /예, 이대로 진행/ })).not.toBeInTheDocument(),
    );
  });

  it("block 이벤트를 받으면 화면의 단계 표시가 바뀐다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockChatResponse({ type: "text", text: "진행할까요?" }, { type: "gate", block: "plan" }),
      )
      .mockResolvedValueOnce(
        mockChatResponse({ type: "block", block: "tasks" }, { type: "done" }),
      );

    await sendAndReachGate(fetchMock);
    expect(screen.getByText(/블록 3/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /예, 이대로 진행/ }));

    await waitFor(() => expect(screen.getByText(/블록 4/)).toBeInTheDocument());
    expect(screen.getByText(/작업 분해/)).toBeInTheDocument();
  });

  it("'수정할 게 있어요'를 누르면 입력창으로 돌아가고 승인은 보내지 않는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockChatResponse({ type: "text", text: "진행할까요?" }, { type: "gate", block: "plan" }),
    );

    await sendAndReachGate(fetchMock);
    await userEvent.click(screen.getByRole("button", { name: /수정할 게 있어요/ }));

    expect(screen.queryByRole("button", { name: /예, 이대로 진행/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("[P3-5] ChatView — 빈 입력", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("빈 메시지는 보내지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("[P4-4] ChatView — 산출물 생성 표시", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("구현 단계에서 답을 기다리는 동안에는 '만드는 중'이라고 알려준다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              await gate;
              controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
              controller.close();
            },
          }),
        ),
      ),
    );

    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "만들어줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/만드는 중/)).toBeInTheDocument());
    release();
    await waitFor(() => expect(screen.queryByText(/만드는 중/)).not.toBeInTheDocument());
  });

  it("artifact 이벤트를 받으면 완성 안내와 주소를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockChatResponse(
          { type: "text", text: "홈페이지를 만들었습니다." },
          { type: "artifact", slug: "my-homepage", fileCount: 3 },
          { type: "done" },
        ),
      ),
    );

    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "만들어줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/파일 3개/)).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /열어보기/ });
    expect(link).toHaveAttribute("href", "/site/my-homepage");
    expect(screen.getByText("/site/my-homepage")).toBeInTheDocument();
  });
});

describe("[P4-5] ChatView — 답변이 잘렸을 때", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("truncated 이벤트를 받으면 이어서 요청하라고 안내한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockChatResponse(
          { type: "text", text: "만드는 중이었습니다..." },
          { type: "truncated" },
          { type: "done" },
        ),
      ),
    );

    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "만들어줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/길어서 중간에 끊겼습니다/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /이어서 계속/ })).toBeInTheDocument();
  });
});

describe("[P4-6] ChatView — 언제든 다음 단계로 갈 수 있어야 한다", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("게이트 안내가 없어도 단계 이동 버튼이 늘 보인다", () => {
    // 실제 사용 중 발견: 모델이 '아래 확인 버튼을 눌러주세요'라고만 하고
    // 마커를 빠뜨리거나, 새로고침으로 게이트 상태가 사라지면 사용자가
    // 다음 단계로 갈 방법이 아예 없었다.
    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);

    expect(screen.getByRole("button", { name: /다음 단계로/ })).toBeInTheDocument();
  });

  it("단계 이동 버튼을 누르면 approved:true로 보낸다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockChatResponse({ type: "block", block: "plan" }, { type: "done" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /다음 단계로/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      conversationId: "conv-1",
      approved: true,
    });
    await waitFor(() => expect(screen.getByText(/블록 3/)).toBeInTheDocument());
  });

  it("마지막 블록에서는 단계 이동 버튼을 감춘다 (더 갈 곳이 없다)", () => {
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    expect(screen.queryByRole("button", { name: /다음 단계로/ })).not.toBeInTheDocument();
  });

  it("답변을 기다리는 동안에는 단계 이동을 막는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ start() {} })),
      ),
    );

    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /다음 단계로/ })).toBeDisabled(),
    );
  });
});

describe("[P6-4] ChatView — 체험·한도로 막혔을 때", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("402로 막히면 이유를 보여주고 요금제로 갈 길을 준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "7일 체험 기간이 끝났어요. 계속 쓰시려면 요금제를 선택해주세요.",
            reason: "trial_expired",
            upgradeTo: "basic",
          }),
          { status: 402 },
        ),
      ),
    );

    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/체험 기간이 끝났어요/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /요금제/ })).toHaveAttribute("href", "/pricing");
  });

  it("보통 오류에는 요금제 링크를 붙이지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockChatResponse({ type: "error", message: "호출 실패" })),
    );

    render(<ChatView conversationId="conv-1" currentBlock="clarify" initialMessages={[]} />);
    await userEvent.type(screen.getByLabelText("메시지"), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/호출 실패/)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /요금제/ })).not.toBeInTheDocument();
  });
})

/**
 * [P7-4b] 완성 후 화면 (FR-029, BL-001).
 *
 * "대화가 끝났습니다"가 아니라 "고칠 곳을 말씀해주세요"가 되어야 한다.
 */
describe("[P7-4b] 유지보수 화면", () => {
  it("유지보수 블록이면 끝났다고 하지 않고 6번 블록으로 보여준다", () => {
    render(
      <ChatView conversationId="conv-1" currentBlock="maintenance" initialMessages={[]} />,
    );

    expect(screen.queryByText("대화가 끝났습니다.")).not.toBeInTheDocument();
    expect(screen.getByText(/블록 6 \/ 6/)).toBeInTheDocument();
    expect(screen.getByText(/유지보수/)).toBeInTheDocument();
  });

  it("예전에 done으로 굳은 대화도 유지보수 화면으로 열린다", () => {
    render(<ChatView conversationId="conv-1" currentBlock="done" initialMessages={[]} />);

    expect(screen.queryByText("대화가 끝났습니다.")).not.toBeInTheDocument();
    expect(screen.getByText(/유지보수/)).toBeInTheDocument();
  });

  it("유지보수에서는 입력해서 보낼 수 있다", async () => {
    render(<ChatView conversationId="conv-1" currentBlock="done" initialMessages={[]} />);

    const box = screen.getByLabelText("메시지");
    expect(box).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "보내기" })).not.toBeDisabled();
  });

  it("유지보수에는 '다음 단계로'가 없다 — 더 갈 단계가 없다", () => {
    render(
      <ChatView conversationId="conv-1" currentBlock="maintenance" initialMessages={[]} />,
    );

    expect(screen.queryByRole("button", { name: /다음 단계로/ })).not.toBeInTheDocument();
  });
});

/**
 * [P7-11] 입력창에 파일 붙이기 (FR-031·FR-032, BL-004·005).
 *
 * 고르는 즉시 올린다 — 보낼 때 한꺼번에 올리면 큰 파일에서 "보내기"가
 * 한참 멈춘 것처럼 보이고, 형식이 틀렸다는 것도 그제야 알게 된다.
 */
describe("[P7-11] 프롬프트 첨부", () => {
  function pngFile(name = "사진.png") {
    return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
  }

  function mockUpload(id = "att-1", name = "사진.png") {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/api/attachments")) {
        return new Response(JSON.stringify({ attachments: [{ id, kind: "image", name }] }), {
          status: 201,
        });
      }
      return mockChatResponse({ type: "text", text: "네" }, { type: "done" });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("파일을 고르면 바로 올리고 이름을 보여준다", async () => {
    const fetchMock = mockUpload();
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    await userEvent.upload(screen.getByLabelText("파일 붙이기"), pngFile());

    await waitFor(() => expect(screen.getByText("사진.png")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/attachments");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("보낼 때 첨부 id를 함께 보낸다", async () => {
    const fetchMock = mockUpload("att-99");
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    await userEvent.upload(screen.getByLabelText("파일 붙이기"), pngFile());
    await waitFor(() => expect(screen.getByText("사진.png")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("메시지"), "이 사진 넣어줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/chat");
      expect(JSON.parse(chatCall![1].body).attachmentIds).toEqual(["att-99"]);
    });
  });

  it("보내고 나면 붙인 것이 비워진다", async () => {
    mockUpload();
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    await userEvent.upload(screen.getByLabelText("파일 붙이기"), pngFile());
    await waitFor(() => expect(screen.getByText("사진.png")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("메시지"), "넣어줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.queryByText("사진.png")).not.toBeInTheDocument());
  });

  it("붙인 것을 하나씩 뗄 수 있다", async () => {
    mockUpload();
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    await userEvent.upload(screen.getByLabelText("파일 붙이기"), pngFile());
    await waitFor(() => expect(screen.getByText("사진.png")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /사진.png 떼기/ }));

    expect(screen.queryByText("사진.png")).not.toBeInTheDocument();
  });

  it("올리다 실패하면 이유를 그대로 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "virus.png은(는) 실행파일이라 올릴 수 없어요." }),
          { status: 400 },
        ),
      ),
    );
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    await userEvent.upload(screen.getByLabelText("파일 붙이기"), pngFile("virus.png"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("실행파일이라 올릴 수 없어요"),
    );
  });

  it("이미지는 토큰을 많이 쓴다고 미리 알려준다", async () => {
    mockUpload();
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    await userEvent.upload(screen.getByLabelText("파일 붙이기"), pngFile());

    await waitFor(() => expect(screen.getByText(/토큰/)).toBeInTheDocument());
  });

  it("만들어진 산출물에 이미지가 들어가면 몇 장인지 알려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockChatResponse(
          { type: "artifact", slug: "site-1", fileCount: 2, imageCount: 1 },
          { type: "done" },
        ),
      ),
    );
    render(<ChatView conversationId="conv-1" currentBlock="implement" initialMessages={[]} />);

    await userEvent.type(screen.getByLabelText("메시지"), "만들어줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/사진 1장/)).toBeInTheDocument());
  });
});

/**
 * [BL-021a] 실패하면 **쓴 글을 돌려준다.**
 *
 * 사용자가 5개 항목짜리 긴 요청을 보냈다가 500을 받았는데, 입력창은 이미
 * 비워진 뒤라 **그 글이 통째로 사라졌다.** 다시 쓰라는 것은 답이 아니다.
 */
describe("[BL-021a] 요청이 실패하면 입력을 되살린다", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  const LONG = "기존 프로젝트에 회원가입, 로그인, 운영자 화면, 문의 게시판을 추가해줘.";

  it("500이 오면 입력창에 쓰던 글이 그대로 남는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("서버 오류", { status: 500 })),
    );

    render(<ChatView conversationId="conv-1" currentBlock="maintenance" initialMessages={[]} />);

    const box = screen.getByLabelText("메시지");
    await userEvent.type(box, LONG);
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(box).toHaveValue(LONG));
  });

  it("실패한 요청은 대화에 남기지 않는다 — 되살린 입력과 겹쳐 두 번 보이면 안 된다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("서버 오류", { status: 500 })),
    );

    render(<ChatView conversationId="conv-1" currentBlock="maintenance" initialMessages={[]} />);

    await userEvent.type(screen.getByLabelText("메시지"), LONG);
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByLabelText("메시지")).toHaveValue(LONG));
    // 말풍선으로도 남아 있으면 같은 글이 화면에 두 번 있게 된다.
    // 되살아난 입력창(textarea) 자체는 세지 않는다 — 그건 되살리기의 결과다.
    const bubbles = screen
      .queryAllByText(LONG)
      .filter((el) => el.tagName.toLowerCase() !== "textarea");
    expect(bubbles).toHaveLength(0);
  });

  it("성공하면 입력창은 비운 채로 둔다 (되살리기가 정상 흐름을 건드리지 않는다)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockChatResponse({ type: "text", text: "네" }, { type: "done" })),
    );

    render(<ChatView conversationId="conv-1" currentBlock="maintenance" initialMessages={[]} />);

    const box = screen.getByLabelText("메시지");
    await userEvent.type(box, "짧은 요청");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText("네")).toBeInTheDocument());
    expect(box).toHaveValue("");
  });
});
