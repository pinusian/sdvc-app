import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-4] GET/POST /api/site/[slug]/settings/api-key — 사용자 본인의
 * Anthropic API 키 등록. **쓰기 전용**이다 — 한 번 저장하면 다시 보여주지
 * 않는다(비밀번호와 같은 취급).
 */

const requireSiteUser = vi.fn();
const setSiteUserApiKey = vi.fn();
const hasSiteUserApiKey = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/site-accounts/access", () => ({
  requireSiteUser: (...args: unknown[]) => requireSiteUser(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  setSiteUserApiKey: (...args: unknown[]) => setSiteUserApiKey(...args),
  hasSiteUserApiKey: (...args: unknown[]) => hasSiteUserApiKey(...args),
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

function getRequest() {
  return new Request("http://localhost:3000/api/site/reading-activity/settings/api-key");
}

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/site/reading-activity/settings/api-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P11-4] GET /api/site/[slug]/settings/api-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSiteUser.mockResolvedValue({ ok: true, project: PROJECT, siteUserId: "su-1" });
    hasSiteUserApiKey.mockResolvedValue(false);
  });

  it("로그인 안 했으면 관문 상태 그대로", async () => {
    requireSiteUser.mockResolvedValue({ ok: false, status: 401, error: "로그인이 필요합니다." });

    const { GET } = await import("@/app/api/site/[slug]/settings/api-key/route");
    const res = await GET(getRequest(), context);
    expect(res.status).toBe(401);
  });

  it("등록 여부만 알려준다 — 값은 절대 안 준다", async () => {
    hasSiteUserApiKey.mockResolvedValue(true);

    const { GET } = await import("@/app/api/site/[slug]/settings/api-key/route");
    const res = await GET(getRequest(), context);
    const body = (await res.clone().json()) as { hasApiKey: boolean };

    expect(body).toEqual({ hasApiKey: true });
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("sk-ant");
  });
});

describe("[P11-4] POST /api/site/[slug]/settings/api-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSiteUser.mockResolvedValue({ ok: true, project: PROJECT, siteUserId: "su-1" });
    setSiteUserApiKey.mockResolvedValue(undefined);
  });

  it("로그인 안 했으면 관문 상태 그대로, 저장도 안 한다", async () => {
    requireSiteUser.mockResolvedValue({ ok: false, status: 401, error: "로그인이 필요합니다." });

    const { POST } = await import("@/app/api/site/[slug]/settings/api-key/route");
    const res = await POST(postRequest({ apiKey: "sk-ant-api03-abcdefgh12345678" }), context);

    expect(res.status).toBe(401);
    expect(setSiteUserApiKey).not.toHaveBeenCalled();
  });

  it("sk-ant-로 시작하지 않으면 400이고 저장하지 않는다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/settings/api-key/route");
    const res = await POST(postRequest({ apiKey: "그냥아무문자열입니다" }), context);

    expect(res.status).toBe(400);
    expect(setSiteUserApiKey).not.toHaveBeenCalled();
  });

  it("너무 짧으면 400이다 (붙여넣기 실수 방지)", async () => {
    const { POST } = await import("@/app/api/site/[slug]/settings/api-key/route");
    const res = await POST(postRequest({ apiKey: "sk-ant-x" }), context);

    expect(res.status).toBe(400);
  });

  it("형식이 맞으면 본인 것으로 저장한다 — 관문이 확인한 siteUserId를 쓴다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/settings/api-key/route");
    const res = await POST(postRequest({ apiKey: "sk-ant-api03-abcdefgh12345678" }), context);

    expect(res.status).toBe(200);
    expect(setSiteUserApiKey).toHaveBeenCalledWith(
      expect.anything(),
      { siteUserId: "su-1", apiKey: "sk-ant-api03-abcdefgh12345678" },
    );
  });

  it("성공 응답에도 키 값을 다시 담지 않는다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/settings/api-key/route");
    const res = await POST(postRequest({ apiKey: "sk-ant-api03-abcdefgh12345678" }), context);

    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("sk-ant-api03-abcdefgh12345678");
  });
});
