import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-3] GET/POST /api/site/[slug]/records — 본인 기록만 읽고 쓴다.
 * 인증은 requireSiteUser 관문 하나로 처리한다([P11-2]의 gateSiteProject와
 * 같은 이유 — 라우트마다 따로 검사하면 하나를 빠뜨린다).
 */

const requireSiteUser = vi.fn();
const listSiteRecordsByUser = vi.fn();
const createSiteRecord = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/site-accounts/access", () => ({
  requireSiteUser: (...args: unknown[]) => requireSiteUser(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  listSiteRecordsByUser: (...args: unknown[]) => listSiteRecordsByUser(...args),
  createSiteRecord: (...args: unknown[]) => createSiteRecord(...args),
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
  return new Request("http://localhost:3000/api/site/reading-activity/records");
}

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/site/reading-activity/records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[P11-3] GET /api/site/[slug]/records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSiteUser.mockResolvedValue({ ok: true, project: PROJECT, siteUserId: "su-1" });
    listSiteRecordsByUser.mockResolvedValue([
      { id: "rec-1", projectId: "proj-1", siteUserId: "su-1", title: "구의 증명", author: null, note: null },
    ]);
  });

  it("로그인 안 했으면(관문이 막으면) 그 상태 그대로 응답한다", async () => {
    requireSiteUser.mockResolvedValue({ ok: false, status: 401, error: "로그인이 필요합니다." });

    const { GET } = await import("@/app/api/site/[slug]/records/route");
    const res = await GET(getRequest(), context);

    expect(res.status).toBe(401);
    expect(listSiteRecordsByUser).not.toHaveBeenCalled();
  });

  it("본인 기록만 project_id·site_user_id로 걸러 돌려준다", async () => {
    const { GET } = await import("@/app/api/site/[slug]/records/route");
    const res = await GET(getRequest(), context);
    const body = (await res.json()) as { records: unknown[] };

    expect(res.status).toBe(200);
    expect(listSiteRecordsByUser).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: "proj-1", siteUserId: "su-1" },
    );
    expect(body.records).toHaveLength(1);
  });
});

describe("[P11-3] POST /api/site/[slug]/records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSiteUser.mockResolvedValue({ ok: true, project: PROJECT, siteUserId: "su-1" });
    createSiteRecord.mockResolvedValue({
      id: "rec-1",
      projectId: "proj-1",
      siteUserId: "su-1",
      title: "구의 증명",
      author: "최진영",
      note: "슬픔에 관한 이야기",
    });
  });

  it("로그인 안 했으면 관문 상태 그대로 응답하고 아무것도 안 만든다", async () => {
    requireSiteUser.mockResolvedValue({ ok: false, status: 401, error: "로그인이 필요합니다." });

    const { POST } = await import("@/app/api/site/[slug]/records/route");
    const res = await POST(postRequest({ title: "구의 증명" }), context);

    expect(res.status).toBe(401);
    expect(createSiteRecord).not.toHaveBeenCalled();
  });

  it("제목이 없으면 400이고 만들지 않는다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/records/route");
    const res = await POST(postRequest({ title: "   " }), context);

    expect(res.status).toBe(400);
    expect(createSiteRecord).not.toHaveBeenCalled();
  });

  it("만들 때 요청 본문의 project_id·site_user_id를 믿지 않고 관문이 확인한 값을 쓴다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/records/route");
    await POST(
      postRequest({ title: "구의 증명", author: "최진영", projectId: "다른-프로젝트-흉내", siteUserId: "다른-사람-흉내" }),
      context,
    );

    expect(createSiteRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "proj-1", siteUserId: "su-1" }),
    );
  });

  it("성공하면 만든 기록을 돌려준다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/records/route");
    const res = await POST(postRequest({ title: "구의 증명", author: "최진영" }), context);
    const body = (await res.json()) as { record?: { title?: string } };

    expect(res.status).toBe(200);
    expect(body.record?.title).toBe("구의 증명");
  });
});
