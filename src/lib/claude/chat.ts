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
  /** 모델이 확장 사고 중임 — 내용은 보내지 않고 신호만 한 번 보낸다 */
  | { type: "thinking" }
  /** [P4-5] 최대 길이에 걸려 답변이 중간에서 끊겼음 */
  | { type: "truncated" }
  /** [P6-2] Anthropic이 알려준 실제 사용량 — 서버가 기록용으로 걷어간다 */
  | { type: "usage"; model: string; inputTokens: number; outputTokens: number }
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

  return res.body.pipeThrough(sseToNdjson());
}

const encoder = new TextEncoder();

function encodeEvent(event: ChatEvent): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n");
}

/**
 * Anthropic SSE 본문을 NDJSON 이벤트로 바꾸는 변환 스트림.
 *
 * ReadableStream을 직접 만들어 읽어치우는 대신 TransformStream을 쓰는 이유는,
 * 브라우저가 천천히 읽으면 그만큼 Anthropic 쪽 읽기도 느려지도록(역압)
 * 두기 위해서다.
 */
function sseToNdjson(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let thinkingAnnounced = false;
  let truncated = false;
  // [P6-2] 사용량은 message_start(입력)와 message_delta(출력)에 나뉘어 온다.
  const usage = { model: "", inputTokens: 0, outputTokens: 0 };

  const handle = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    collectUsage(line, usage);
    if (isMaxTokensStop(line)) {
      truncated = true;
      return;
    }

    const delta = deltaOf(line);
    if (delta === null) return;

    if (delta.kind === "thinking") {
      // 사고 내용 자체는 화면에 보내지 않는다. 다만 화면이 멈춘 것처럼
      // 보이지 않도록 "생각 중"이라는 신호만 한 번 보낸다.
      if (!thinkingAnnounced) {
        thinkingAnnounced = true;
        controller.enqueue(encodeEvent({ type: "thinking" }));
      }
      return;
    }

    controller.enqueue(encodeEvent({ type: "text", text: delta.text }));
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // 청크가 줄 중간에서 잘려 들어올 수 있으므로 버퍼에 이어붙인 뒤
      // 완결된 줄만 꺼내 처리한다.
      buffer += decoder.decode(chunk, { stream: true });
      let newlineAt: number;
      while ((newlineAt = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        handle(line, controller);
      }
    },
    flush(controller) {
      handle(buffer, controller);
      // 잘렸더라도 done은 반드시 보낸다 — 화면이 "보내는 중"에 멈추면 안 된다.
      if (truncated) controller.enqueue(encodeEvent({ type: "truncated" }));
      if (usage.model && usage.inputTokens + usage.outputTokens > 0) {
        controller.enqueue(encodeEvent({ type: "usage", ...usage }));
      }
      controller.enqueue(encodeEvent({ type: "done" }));
    },
  });
}

/**
 * [P6-2] 사용량을 모은다. 입력 토큰은 `message_start`, 출력 토큰은
 * `message_delta`에 **누적값**으로 온다 — 우리가 세지 않고 그대로 받는다.
 */
function collectUsage(
  line: string,
  usage: { model: string; inputTokens: number; outputTokens: number },
): void {
  const payload = payloadOf(line);
  if (!payload) return;
  try {
    const parsed = JSON.parse(payload) as {
      type?: string;
      message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    if (parsed.type === "message_start") {
      usage.model = parsed.message?.model ?? usage.model;
      usage.inputTokens = parsed.message?.usage?.input_tokens ?? usage.inputTokens;
      usage.outputTokens = parsed.message?.usage?.output_tokens ?? usage.outputTokens;
    } else if (parsed.type === "message_delta" && parsed.usage) {
      usage.outputTokens = parsed.usage.output_tokens ?? usage.outputTokens;
    }
  } catch {
    // 파싱 못 하는 줄은 무시한다.
  }
}

/** [P4-5] 최대 길이에 걸려 끊긴 응답인가? */
function isMaxTokensStop(line: string): boolean {
  const payload = payloadOf(line);
  if (!payload) return false;
  try {
    const parsed = JSON.parse(payload) as {
      type?: string;
      delta?: { stop_reason?: string };
    };
    return parsed.type === "message_delta" && parsed.delta?.stop_reason === "max_tokens";
  } catch {
    return false;
  }
}

type Delta = { kind: "text"; text: string } | { kind: "thinking" };

/** SSE 한 줄에서 `data:` 뒤의 JSON 문자열을 꺼낸다. 아니면 null. */
function payloadOf(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;
  return payload;
}

/** SSE 한 줄에서 델타를 뽑는다. 우리가 쓰지 않는 줄이면 null. */
function deltaOf(line: string): Delta | null {
  const payload = payloadOf(line);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (parsed.type !== "content_block_delta") return null;

    if (parsed.delta?.type === "thinking_delta") return { kind: "thinking" };
    if (parsed.delta?.type !== "text_delta") return null;
    return typeof parsed.delta.text === "string" ? { kind: "text", text: parsed.delta.text } : null;
  } catch {
    // 파싱할 수 없는 줄(주석·keep-alive 등)은 조용히 넘긴다.
    return null;
  }
}

function singleEventStream(event: ChatEvent): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeEvent(event));
      controller.close();
    },
  });
}
