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
