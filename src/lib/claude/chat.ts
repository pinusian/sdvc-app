/**
 * [P3-2] Claude API(Anthropic Messages) 스트리밍 호출 모듈.
 *
 * 설계 두 가지:
 * 1) `fetchImpl`을 주입받는다 — [P2-5]에서 Supabase 클라이언트를 주입한 것과
 *    같은 이유로, 실제 네트워크 없이 단위 테스트할 수 있게 하려는 것.
 * 2) 바깥으로는 SSE가 아니라 **NDJSON 이벤트**(한 줄에 JSON 하나)를 흘린다.
 *    지금은 text/done/error 뿐이지만, [P3-6] 승인 게이트처럼 텍스트가 아닌
 *    사건을 나중에 같은 통로로 추가하기 위해서다.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface CreateChatStreamOptions {
  apiKey: string;
  messages: ChatMessage[];
  system?: string;
  model?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_MAX_TOKENS = 8192;

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export async function createChatStream({
  apiKey,
  messages,
  system,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  fetchImpl = fetch,
}: CreateChatStreamOptions): Promise<ReadableStream<Uint8Array>> {
  const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      ...(system ? { system } : {}),
      messages,
    }),
  });

  if (!res.ok || !res.body) {
    // 응답 본문에는 우리 키가 들어 있지 않지만, 혹시 모를 노출을 막기 위해
    // 사용자에게는 상태 코드만 알린다.
    return singleEventStream({
      type: "error",
      message: `Claude API 호출에 실패했습니다. (상태 ${res.status})`,
    });
  }

  return toNdjsonStream(res.body);
}

/** Anthropic SSE 본문을 NDJSON 이벤트 스트림으로 변환한다. */
function toNdjsonStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          // 청크가 줄 중간에서 잘려 들어올 수 있으므로 버퍼에 이어붙인 뒤
          // 완결된 줄만 꺼내 처리한다.
          buffer += decoder.decode(value, { stream: true });
          let newlineAt: number;
          while ((newlineAt = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineAt);
            buffer = buffer.slice(newlineAt + 1);
            const text = textDeltaOf(line);
            if (text) write({ type: "text", text });
          }
        }

        const tail = textDeltaOf(buffer);
        if (tail) write({ type: "text", text: tail });
        write({ type: "done" });
      } catch (error) {
        write({
          type: "error",
          message: error instanceof Error ? error.message : "스트림 처리 중 오류가 발생했습니다.",
        });
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

/** SSE 한 줄에서 텍스트 델타를 뽑는다. 텍스트 델타가 아니면 null. */
function textDeltaOf(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;

  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;

  try {
    const parsed = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (parsed.type !== "content_block_delta") return null;
    if (parsed.delta?.type !== "text_delta") return null;
    return parsed.delta.text ?? null;
  } catch {
    // 파싱할 수 없는 줄(주석·keep-alive 등)은 조용히 넘긴다.
    return null;
  }
}

function singleEventStream(event: ChatEvent): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      controller.close();
    },
  });
}
