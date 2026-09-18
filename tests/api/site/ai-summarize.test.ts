import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-4] POST /api/site/[slug]/ai/summarize — 로그인한 사용자 본인의
 * 키로 서버가 대신 Claude를 호출한다. 과금은 그 키의 주인(사용자)에게
 * 나간다 — 이 서버나 개발자에게 나가지 않는다.
 */

const requireSiteUser = vi.fn();
const getSiteUserApiKey = vi.fn();
const callSiteUserAI = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/site-accounts/access", () => ({
  requireSiteUser: (...args: unknown[]) => requireSiteUser(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  getSiteUserApiKey: (...args: unknown[]) => getSiteUserApiKey(...args),
}));

vi.mock("@/lib/site-accounts/ai-proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site-accounts/ai-proxy")>()),
  callSiteUserAI: (...args: unknown[]) => callSiteUserAI(...args),
}));

const PROJECT = {
  id: "proj-1",
  ownerId: "dev-1",
  name: "독서활동",
  slug: "reading-activity",
  visibility: "link",
  status: "deployed",
  blockedAt: null,
  siteLoginEnabled: true,
};

const context = { params: Promise.resolve({ slug: "reading-activity" }) };

function request(body: unknown) {
  return new Request("http://localhost:3000/api/site/reading-activity/ai/summarize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P11-4] POST /api/site/[slug]/ai/summarize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSiteUser.mockResolvedValue({ ok: true, project: PROJECT, siteUserId: "su-1" });
    getSiteUserApiKey.mockResolvedValue("sk-ant-user-own-key");
    callSiteUserAI.mockResolvedValue({ text: "이 책은 슬픔에 관한 이야기다.", inputTokens: 100, outputTokens: 30 });
  });

  it("로그인 안 했으면 관문 상태 그대로, 호출하지 않는다", async () => {
    requireSiteUser.mockResolvedValue({ ok: false, status: 401, error: "로그인이 필요합니다." });

    const { POST } = await import("@/app/api/site/[slug]/ai/summarize/route");
    const res = await POST(request({ prompt: "요약해줘" }), context);

    expect(res.status).toBe(401);
    expect(callSiteUserAI).not.toHaveBeenCalled();
  });

  it("내용이 없으면 400이다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/ai/summarize/route");
    const res = await POST(request({ prompt: "   " }), context);

    expect(res.status).toBe(400);
    expect(callSiteUserAI).not.toHaveBeenCalled();
  });

  it("너무 긴 내용은 400이다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/ai/summarize/route");
    const res = await POST(request({ prompt: "가".repeat(20_001) }), context);

    expect(res.status).toBe(400);
    expect(callSiteUserAI).not.toHaveBeenCalled();
  });

  it("본인 키를 등록하지 않았으면 400이고, 등록 안내를 준다", async () => {
    getSiteUserApiKey.mockResolvedValue(null);

    const { POST } = await import("@/app/api/site/[slug]/ai/summarize/route");
    const res = await POST(request({ prompt: "요약해줘" }), context);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("API 키");
    expect(callSiteUserAI).not.toHaveBeenCalled();
  });

  it("등록된 본인 키로 호출하고 요약을 돌려준다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/ai/summarize/route");
    const res = await POST(request({ prompt: "이 책을 요약해줘: ..." }), context);
    const body = (await res.json()) as { summary?: string };

    expect(res.status).toBe(200);
    expect(callSiteUserAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-ant-user-own-key", prompt: "이 책을 요약해줘: ..." }),
    );
    expect(body.summary).toBe("이 책은 슬픔에 관한 이야기다.");
  });

  it("Anthropic 호출이 실패하면 상태 코드만 전달하고 속사정은 감춘다", async () => {
    const { SiteAIError } = await import("@/lib/site-accounts/ai-proxy");
    callSiteUserAI.mockRejectedValue(new SiteAIError(401, "invalid x-api-key: sk-ant-비슷한문자열"));

    const { POST } = await import("@/app/api/site/[slug]/ai/summarize/route");
    const res = await POST(request({ prompt: "요약해줘" }), context);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(502);
    expect(body.error).not.toContain("sk-ant");
  });
});
