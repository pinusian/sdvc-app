/**
 * [P11-4] 사용자(방문자) 본인의 Anthropic API 키로 이 서버가 대신 호출한다.
 *
 * Story-Doing 프로젝트가 했던 방식(BL-024)과 정반대다 — 그쪽은 **브라우저가
 * 직접** 호출해 키가 개발자도구 네트워크 탭에 그대로 보였다. 여기서는
 * **서버가** 사용자 본인의(암호화 저장돼 있던) 키로 대신 부르므로, 그 키가
 * 브라우저에 한 번도 노출되지 않는다.
 *
 * 모델은 날짜 박힌 옛 스냅샷을 쓰지 않는다([BL-024]와 같은 원칙) — 이
 * 서버 자신의 `/api/chat`이 쓰는 것과 같은 `claude-sonnet-5`.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048;

export class SiteAIError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SiteAIError";
    this.status = status;
  }
}

export interface CallSiteUserAIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callSiteUserAI({
  apiKey,
  prompt,
  fetchImpl = fetch,
}: {
  apiKey: string;
  prompt: string;
  fetchImpl?: typeof fetch;
}): Promise<CallSiteUserAIResult> {
  const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    // 본문에는 사용자의 키 일부가 에코백될 수 있다(예: "invalid x-api-key: sk-ant-...") —
    // 그대로 내보내지 않고 상태 코드만 담는다.
    await res.text().catch(() => "");
    throw new SiteAIError(res.status, `Claude API 오류 (상태 ${res.status})`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (data.content ?? [])
    .map((block) => block.text ?? "")
    .join("\n");

  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}
