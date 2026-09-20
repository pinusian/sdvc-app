import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P11-6] 개발자(교수) 관리 화면 — 사용자 목록·기록 열람·차단.
 *
 * `/api/projects/[id]/site-users/...`. 방문자 계정(`site_users`)은
 * `profiles`(개발자)와 완전히 다른 표이므로, 여기서도 [P5-3]·[P7-6b]와 같은
 * 소유권 검사(`getProjectById(admin, id, user.id)`)를 그대로 쓴다 — 남의
 * 프로젝트의 방문자 목록을 보거나 정지시킬 수 있으면 안 된다.
 *
 * `siteUserId`도 **그 프로젝트 소속인지** 따로 확인한다 — projectId 없이
 * id만으로 정지·조회가 되면, 다른 프로젝트의 사용자 id를 알아내 정지시키거나
 * 기록을 훔쳐볼 수 있다.
 */

const getUser = vi.fn();
const getProjectById = vi.fn();
const listSiteUsersByProject = vi.fn();
const getOwnedSiteUser = vi.fn();
const suspendSiteUser = vi.fn();
const unsuspendSiteUser = vi.fn();
const listSiteRecordsByUser = vi.fn();
const setSiteUserPasswordHash = vi.fn();
const generateTempPassword = vi.fn();
const hashPassword = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
}));

vi.mock("@/lib/site-accounts/store", () => ({
  listSiteUsersByProject: (...args: unknown[]) => listSiteUsersByProject(...args),
  getOwnedSiteUser: (...args: unknown[]) => getOwnedSiteUser(...args),
  suspendSiteUser: (...args: unknown[]) => suspendSiteUser(...args),
  unsuspendSiteUser: (...args: unknown[]) => unsuspendSiteUser(...args),
  listSiteRecordsByUser: (...args: unknown[]) => listSiteRecordsByUser(...args),
  setSiteUserPasswordHash: (...args: unknown[]) => setSiteUserPasswordHash(...args),
}));

vi.mock("@/lib/site-accounts/crypto", () => ({
  generateTempPassword: (...args: unknown[]) => generateTempPassword(...args),
  hashPassword: (...args: unknown[]) => hashPassword(...args),
}));

const PROJECT = { id: "proj-1", ownerId: "user-1", name: "독서활동", slug: "reading", status: "deployed" };

const SITE_USER = {
  id: "site-user-1",
  projectId: "proj-1",
  email: "learner@example.com",
  displayName: "학습자",
  suspendedAt: null,
  suspendedReason: null,
};

const listContext = { params: Promise.resolve({ id: "proj-1" }) };
const userContext = { params: Promise.resolve({ id: "proj-1", siteUserId: "site-user-1" }) };

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`);
}

function postRequest(path: string, body?: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("[P11-6] GET /api/projects/[id]/site-users — 사용자 목록", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    listSiteUsersByProject.mockResolvedValue([SITE_USER]);
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import("@/app/api/projects/[id]/site-users/route");
    const res = await GET(getRequest("/api/projects/proj-1/site-users"), listContext);
    expect(res.status).toBe(401);
    expect(listSiteUsersByProject).not.toHaveBeenCalled();
  });

  it("내 프로젝트가 아니면 404 — 존재 자체를 숨긴다", async () => {
    getProjectById.mockResolvedValue(null);
    const { GET } = await import("@/app/api/projects/[id]/site-users/route");
    const res = await GET(getRequest("/api/projects/proj-1/site-users"), listContext);
    expect(res.status).toBe(404);
    expect(listSiteUsersByProject).not.toHaveBeenCalled();
  });

  it("비밀번호 해시·API 키 같은 민감정보 없이 목록을 돌려준다", async () => {
    const { GET } = await import("@/app/api/projects/[id]/site-users/route");
    const res = await GET(getRequest("/api/projects/proj-1/site-users"), listContext);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { users: unknown[] };
    expect(data.users).toEqual([SITE_USER]);
    expect(listSiteUsersByProject).toHaveBeenCalledWith(expect.anything(), "proj-1");
  });
});

describe("[P11-6] POST /api/projects/[id]/site-users/[siteUserId]/suspend — 정지", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    getOwnedSiteUser.mockResolvedValue(SITE_USER);
    suspendSiteUser.mockResolvedValue(undefined);
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/suspend/route");
    const res = await POST(
      postRequest("/api/projects/proj-1/site-users/site-user-1/suspend", { reason: "규칙 위반" }),
      userContext,
    );
    expect(res.status).toBe(401);
    expect(suspendSiteUser).not.toHaveBeenCalled();
  });

  it("내 프로젝트가 아니면 404", async () => {
    getProjectById.mockResolvedValue(null);
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/suspend/route");
    const res = await POST(
      postRequest("/api/projects/proj-1/site-users/site-user-1/suspend", { reason: "규칙 위반" }),
      userContext,
    );
    expect(res.status).toBe(404);
    expect(suspendSiteUser).not.toHaveBeenCalled();
  });

  it("그 사용자가 없거나 다른 프로젝트 소속이면 404 (id만 알아내 정지시키는 것을 막는다)", async () => {
    // getOwnedSiteUser 자체가 "없음"과 "다른 프로젝트 소속"을 둘 다 null로 숨긴다.
    getOwnedSiteUser.mockResolvedValue(null);
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/suspend/route");
    const res = await POST(
      postRequest("/api/projects/proj-1/site-users/site-user-1/suspend", { reason: "규칙 위반" }),
      userContext,
    );
    expect(res.status).toBe(404);
    expect(suspendSiteUser).not.toHaveBeenCalled();
  });

  it("사유가 비어 있으면 400", async () => {
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/suspend/route");
    const res = await POST(
      postRequest("/api/projects/proj-1/site-users/site-user-1/suspend", { reason: "  " }),
      userContext,
    );
    expect(res.status).toBe(400);
    expect(suspendSiteUser).not.toHaveBeenCalled();
  });

  it("정상 요청이면 정지시키고 200", async () => {
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/suspend/route");
    const res = await POST(
      postRequest("/api/projects/proj-1/site-users/site-user-1/suspend", { reason: "규칙 위반" }),
      userContext,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suspended: true });
    expect(suspendSiteUser).toHaveBeenCalledWith(expect.anything(), {
      siteUserId: "site-user-1",
      reason: "규칙 위반",
    });
  });
});

describe("[P11-6] POST /api/projects/[id]/site-users/[siteUserId]/unsuspend — 정지 해제", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    getOwnedSiteUser.mockResolvedValue({ ...SITE_USER, suspendedAt: "2026-09-18T00:00:00.000Z" });
    unsuspendSiteUser.mockResolvedValue(undefined);
  });

  it("내 프로젝트가 아니면 404", async () => {
    getProjectById.mockResolvedValue(null);
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/unsuspend/route");
    const res = await POST(postRequest("/api/projects/proj-1/site-users/site-user-1/unsuspend"), userContext);
    expect(res.status).toBe(404);
    expect(unsuspendSiteUser).not.toHaveBeenCalled();
  });

  it("그 사용자가 없거나 다른 프로젝트 소속이면 404", async () => {
    getOwnedSiteUser.mockResolvedValue(null);
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/unsuspend/route");
    const res = await POST(postRequest("/api/projects/proj-1/site-users/site-user-1/unsuspend"), userContext);
    expect(res.status).toBe(404);
    expect(unsuspendSiteUser).not.toHaveBeenCalled();
  });

  it("정상 요청이면 정지를 풀고 200", async () => {
    const { POST } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/unsuspend/route");
    const res = await POST(postRequest("/api/projects/proj-1/site-users/site-user-1/unsuspend"), userContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suspended: false });
    expect(unsuspendSiteUser).toHaveBeenCalledWith(expect.anything(), "site-user-1");
  });
});

describe("[P11-6] GET /api/projects/[id]/site-users/[siteUserId]/records — 기록 열람", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    getOwnedSiteUser.mockResolvedValue(SITE_USER);
    listSiteRecordsByUser.mockResolvedValue([
      { id: "rec-1", projectId: "proj-1", siteUserId: "site-user-1", title: "어린 왕자", author: "생텍쥐페리", note: "좋았다" },
    ]);
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/records/route");
    const res = await GET(getRequest("/api/projects/proj-1/site-users/site-user-1/records"), userContext);
    expect(res.status).toBe(401);
  });

  it("내 프로젝트가 아니면 404", async () => {
    getProjectById.mockResolvedValue(null);
    const { GET } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/records/route");
    const res = await GET(getRequest("/api/projects/proj-1/site-users/site-user-1/records"), userContext);
    expect(res.status).toBe(404);
  });

  it("없거나 다른 프로젝트 소속 사용자면 404 (남의 방문자 기록을 못 훔쳐본다)", async () => {
    getOwnedSiteUser.mockResolvedValue(null);
    const { GET } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/records/route");
    const res = await GET(getRequest("/api/projects/proj-1/site-users/site-user-1/records"), userContext);
    expect(res.status).toBe(404);
    expect(listSiteRecordsByUser).not.toHaveBeenCalled();
  });

  it("정상 요청이면 그 사용자의 기록만 돌려준다", async () => {
    const { GET } = await import("@/app/api/projects/[id]/site-users/[siteUserId]/records/route");
    const res = await GET(getRequest("/api/projects/proj-1/site-users/site-user-1/records"), userContext);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { records: unknown[] };
    expect(data.records).toHaveLength(1);
    expect(listSiteRecordsByUser).toHaveBeenCalledWith(expect.anything(), {
      projectId: "proj-1",
      siteUserId: "site-user-1",
    });
  });
});

/**
 * [BL-031] POST /api/projects/[id]/site-users/[siteUserId]/reset-password —
 * 방문자 계정은 이메일 발송 수단이 없어([BL-030]과 달리) 본인이 직접
 * "비밀번호 찾기"를 할 수 없다. 개발자가 관리 화면에서 대신 새 임시
 * 비밀번호를 만들어 본인에게 전달한다. 소유권 검사는 정지·기록 열람과
 * 완전히 같다.
 */
describe("[BL-031] POST /api/projects/[id]/site-users/[siteUserId]/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    getOwnedSiteUser.mockResolvedValue(SITE_USER);
    generateTempPassword.mockReturnValue("tempPass9x2k");
    hashPassword.mockResolvedValue("salt:hash");
    setSiteUserPasswordHash.mockResolvedValue(undefined);
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import(
      "@/app/api/projects/[id]/site-users/[siteUserId]/reset-password/route"
    );
    const res = await POST(postRequest("/api/projects/proj-1/site-users/site-user-1/reset-password"), userContext);
    expect(res.status).toBe(401);
    expect(setSiteUserPasswordHash).not.toHaveBeenCalled();
  });

  it("내 프로젝트가 아니면 404", async () => {
    getProjectById.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/projects/[id]/site-users/[siteUserId]/reset-password/route"
    );
    const res = await POST(postRequest("/api/projects/proj-1/site-users/site-user-1/reset-password"), userContext);
    expect(res.status).toBe(404);
    expect(setSiteUserPasswordHash).not.toHaveBeenCalled();
  });

  it("그 사용자가 없거나 다른 프로젝트 소속이면 404", async () => {
    getOwnedSiteUser.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/projects/[id]/site-users/[siteUserId]/reset-password/route"
    );
    const res = await POST(postRequest("/api/projects/proj-1/site-users/site-user-1/reset-password"), userContext);
    expect(res.status).toBe(404);
    expect(setSiteUserPasswordHash).not.toHaveBeenCalled();
  });

  it("정상 요청이면 임시 비밀번호를 만들어 해시로 저장하고, 평문은 응답에 한 번만 담는다", async () => {
    const { POST } = await import(
      "@/app/api/projects/[id]/site-users/[siteUserId]/reset-password/route"
    );
    const res = await POST(postRequest("/api/projects/proj-1/site-users/site-user-1/reset-password"), userContext);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tempPassword: "tempPass9x2k" });
    expect(hashPassword).toHaveBeenCalledWith("tempPass9x2k");
    expect(setSiteUserPasswordHash).toHaveBeenCalledWith(expect.anything(), {
      siteUserId: "site-user-1",
      passwordHash: "salt:hash",
    });
  });
});
