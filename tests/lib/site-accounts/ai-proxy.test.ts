import { describe, expect, it, vi } from "vitest";
import { callSiteUserAI, SiteAIError } from "@/lib/site-accounts/ai-proxy";

/**
 * [P11-4] 사용자 본인의 Anthropic API 키로 서버가 대신 호출한다.
 *
 * Story-Doing 프로젝트가 겪은 것(BL-024)과 정반대로 간다 — 브라우저가
 * 아니라 **이 서버가** 호출하므로, 사용자의 키는 브라우저 네트워크
 * 탭에 한 번도 노출되지 않는다.
 */

function fakeFetch(response: { ok: boolean; status?: number; json?: unknown; text?: string }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.json,
    text: async () => response.text ?? "",
  });
}

describe("[P11-4] callSiteUserAI", () => {
  it("사용자의 키를 x-api-key 헤더로 실어 Anthropic에 보낸다", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: { content: [{ type: "text", text: "요약입니다." }], usage: { input_tokens: 10, output_tokens: 5 } },
    });

    await callSiteUserAI({ apiKey: "sk-ant-user-own-key", prompt: "이 책을 요약해줘", fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-user-own-key");
  });

  it("세대 모델 이름(claude-sonnet-5)을 쓴다 — 날짜 박힌 스냅샷을 지어내지 않는다([BL-024]와 같은 원칙)", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: { content: [{ type: "text", text: "요약" }], usage: { input_tokens: 1, output_tokens: 1 } },
    });

    await callSiteUserAI({ apiKey: "sk-ant-x", prompt: "요약해줘", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("답변 텍스트와 사용량을 돌려준다", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: {
        content: [{ type: "text", text: "이 책은 " }, { type: "text", text: "슬픔에 관한 이야기다." }],
        usage: { input_tokens: 120, output_tokens: 40 },
      },
    });

    const result = await callSiteUserAI({ apiKey: "sk-ant-x", prompt: "요약해줘", fetchImpl });

    expect(result.text).toBe("이 책은 \n슬픔에 관한 이야기다.");
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(40);
  });

  it("Anthropic이 오류를 주면 SiteAIError로 상태 코드만 담아 던진다 (본문은 노출 안 함)", async () => {
    const fetchImpl = fakeFetch({
      ok: false,
      status: 401,
      text: '{"error":{"message":"invalid x-api-key 실제키값비슷한문자열"}}',
    });

    await expect(
      callSiteUserAI({ apiKey: "sk-ant-bad", prompt: "요약해줘", fetchImpl }),
    ).rejects.toBeInstanceOf(SiteAIError);

    try {
      await callSiteUserAI({ apiKey: "sk-ant-bad", prompt: "요약해줘", fetchImpl });
    } catch (e) {
      expect(e).toBeInstanceOf(SiteAIError);
      expect((e as SiteAIError).status).toBe(401);
    }
  });
});
