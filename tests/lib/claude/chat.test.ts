import { describe, expect, it, vi } from "vitest";
import { createChatStream, type ChatEvent } from "@/lib/claude/chat";

/**
 * [P3-2] Claude API 호출 모듈 단위 테스트.
 *
 * 실제 네트워크를 타지 않도록 fetch를 인자로 주입한다([P2-5]에서 Supabase
 * 클라이언트를 주입한 것과 같은 구조).
 */

/** Anthropic의 SSE 응답을 흉내내는 가짜 Response를 만든다. */
function sseResponse(lines: string[], init?: { ok?: boolean; status?: number }) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    body,
    text: async () => lines.join(""),
  } as unknown as Response;
}

/** NDJSON 스트림을 이벤트 배열로 읽어낸다. */
async function readEvents(stream: ReadableStream<Uint8Array>): Promise<ChatEvent[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChatEvent);
}

describe("[P3-2] createChatStream", () => {
  it("Anthropic Messages API에 스트리밍 요청을 보낸다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([]));

    await createChatStream({
      apiKey: "test-key",
      system: "너는 SDVC 진행자다.",
      messages: [{ role: "user", content: "홈페이지 만들고 싶어" }],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(init.body);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system).toBe("너는 SDVC 진행자다.");
    expect(body.messages).toEqual([
      { role: "user", content: "홈페이지 만들고 싶어" },
    ]);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("SSE 델타를 NDJSON text 이벤트로 바꾸고 마지막에 done을 붙인다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안녕"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"하세요"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );

    const stream = await createChatStream({
      apiKey: "test-key",
      messages: [{ role: "user", content: "안녕" }],
      fetchImpl,
    });

    expect(await readEvents(stream)).toEqual([
      { type: "text", text: "안녕" },
      { type: "text", text: "하세요" },
      { type: "done" },
    ]);
  });

  it("SSE 청크가 줄 중간에서 잘려 들어와도 이어붙여 처리한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_de',
        'lta","text":"이어붙임"}}\n\n',
      ]),
    );

    const stream = await createChatStream({
      apiKey: "test-key",
      messages: [{ role: "user", content: "안녕" }],
      fetchImpl,
    });

    expect(await readEvents(stream)).toEqual([
      { type: "text", text: "이어붙임" },
      { type: "done" },
    ]);
  });

  it("확장 사고(thinking) 중에는 thinking 이벤트를 한 번만 알리고 내용은 흘리지 않는다", async () => {
    // 실제 API 확인 결과, 모델은 계획 수립 같은 요청에서 스스로 확장 사고를 켠다.
    // 사고 내용(chain of thought)은 화면에 보내지 않되, 화면이 빈 채로 멈춘 것처럼
    // 보이지 않도록 "생각 중"이라는 신호만 한 번 보낸다.
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"내부 추론 내용"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"더 많은 추론"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"abc"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"계획입니다"}}\n\n',
      ]),
    );

    const stream = await createChatStream({
      apiKey: "test-key",
      messages: [{ role: "user", content: "계획 세워줘" }],
      fetchImpl,
    });

    const events = await readEvents(stream);
    expect(events).toEqual([
      { type: "thinking" },
      { type: "text", text: "계획입니다" },
      { type: "done" },
    ]);
    expect(JSON.stringify(events)).not.toContain("내부 추론 내용");
  });

  it("[P4-5] 최대 길이에 걸려 답변이 잘리면 truncated 이벤트로 알린다", async () => {
    // 실제 검증에서 발견: 구현 단계에서 파일을 쓰다 max_tokens에 걸리면
    // 답변이 문장 중간에서 끊기고, 닫히지 않은 파일 블록은 저장되지 않는데도
    // 사용자에게는 아무 설명이 없었다.
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"```file:index.html"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
      ]),
    );

    const stream = await createChatStream({
      apiKey: "test-key",
      messages: [{ role: "user", content: "만들어줘" }],
      fetchImpl,
    });

    const events = await readEvents(stream);
    expect(events).toContainEqual({ type: "truncated" });
    // 잘렸어도 done은 온다 (화면이 "보내는 중"에 멈추면 안 되므로)
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("[P4-5] 정상 종료(end_turn)에는 truncated를 보내지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"끝"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      ]),
    );

    const stream = await createChatStream({
      apiKey: "test-key",
      messages: [{ role: "user", content: "안녕" }],
      fetchImpl,
    });

    expect(await readEvents(stream)).toEqual([{ type: "text", text: "끝" }, { type: "done" }]);
  });

  it("Anthropic이 오류를 반환하면 error 이벤트로 알리고 키 값은 노출하지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse(['{"error":{"type":"authentication_error","message":"invalid x-api-key"}}'], {
        ok: false,
        status: 401,
      }),
    );

    const stream = await createChatStream({
      apiKey: "super-secret-key",
      messages: [{ role: "user", content: "안녕" }],
      fetchImpl,
    });

    const events = await readEvents(stream);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(JSON.stringify(events)).not.toContain("super-secret-key");
  });
});

describe("[P6-2] 토큰 사용량 전달", () => {
  it("Anthropic이 알려준 실제 사용량을 usage 이벤트로 내보낸다", async () => {
    // 입력 토큰은 message_start에, 출력 토큰은 message_delta에 들어온다.
    // 우리가 추정하지 않고 **실제 청구 근거 값**을 그대로 쓴다.
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":1234,"output_tokens":1}}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안녕"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":567}}\n\n',
      ]),
    );

    const stream = await createChatStream({
      apiKey: "test-key",
      messages: [{ role: "user", content: "안녕" }],
      fetchImpl,
    });

    const events = await readEvents(stream);
    expect(events).toContainEqual({
      type: "usage",
      model: "claude-sonnet-5",
      inputTokens: 1234,
      outputTokens: 567,
    });
    // 사용량은 화면에 보여줄 것이 아니므로 done보다 앞에 온다(서버가 걷어간다)
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("사용량 정보가 없으면 usage 이벤트를 만들지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n\n']),
    );

    const stream = await createChatStream({
      apiKey: "test-key",
      messages: [{ role: "user", content: "안녕" }],
      fetchImpl,
    });

    expect((await readEvents(stream)).some((e) => e.type === "usage")).toBe(false);
  });
});
