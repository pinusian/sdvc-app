import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P8-2] /api/admin/developers — 개발자 관리 (FR-014).
 *
 * 이 라우트는 **세 가지를 반드시 함께** 해야 한다:
 *   ① adminCan으로 판정  ② 행위 수행  ③ 감사 로그
 * 하나라도 빠지면 "누가 남의 계정을 정지했는지 모르는" 상태가 된다.
 */

const getUser = vi.fn();
const maybeSingle = vi.fn();
const listDevelopers = vi.fn();
const setSuspended = vi.fn();
const extendTrial = vi.fn();
const grantGrade = vi.fn();
const setMonthlyLimit = vi.fn();
const recordAdminAction = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

vi.mock("@/lib/admin/developers", () => ({
  listDevelopers: (...a: unknown[]) => listDevelopers(...a),
  setSuspended: (...a: unknown[]) => setSuspended(...a),
  extendTrial: (...a: unknown[]) => extendTrial(...a),
  grantGrade: (...a: unknown[]) => grantGrade(...a),
  setMonthlyLimit: (...a: unknown[]) => setMonthlyLimit(...a),
}));

vi.mock("@/lib/admin/audit", () => ({
  recordAdminAction: (...a: unknown[]) => recordAdminAction(...a),
}));

const get = () => new Request("http://localhost:3000/api/admin/developers");
const post = (body: unknown) =>
  new Request("http://localhost:3000/api/admin/developers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("[P8-2] /api/admin/developers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    maybeSingle.mockResolvedValue({
      data: { role: "admin", admin_tier: "super", suspended_at: null },
      error: null,
    });
    listDevelopers.mockResolvedValue([{ id: "user-9", email: "dev@example.com" }]);
    setSuspended.mockResolvedValue(undefined);
    extendTrial.mockResolvedValue("2026-09-27T00:00:00.000Z");
    recordAdminAction.mockResolvedValue({ recorded: true });
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { GET } = await import("@/app/api/admin/developers/route");
    expect((await GET(get())).status).toBe(401);
    expect(listDevelopers).not.toHaveBeenCalled();
  });

  it("관리자가 아니면 404 (관리자 화면이 있다는 사실도 숨긴다)", async () => {
    maybeSingle.mockResolvedValue({
      data: { role: "developer", admin_tier: "super", suspended_at: null },
      error: null,
    });

    const { GET } = await import("@/app/api/admin/developers/route");
    const res = await GET(get());

    expect(res.status).toBe(404);
    expect(listDevelopers).not.toHaveBeenCalled();
  });

  it("목록을 보는 것도 감사 로그에 남는다", async () => {
    const { GET } = await import("@/app/api/admin/developers/route");
    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: "admin-1", action: "developer:read" }),
    );
  });

  it("정지하면 대상과 사유가 감사 로그에 남는다", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(
      post({ userId: "user-9", action: "suspend", reason: "불법 콘텐츠" }),
    );

    expect(res.status).toBe(200);
    expect(setSuspended).toHaveBeenCalledWith(expect.anything(), "user-9", true, "불법 콘텐츠");
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      // succeeded 기본값(true)은 recordAdminAction의 책임이고 거기서 검증한다
      expect.objectContaining({
        action: "developer:suspend",
        targetType: "profile",
        targetId: "user-9",
        detail: expect.objectContaining({ suspended: true, reason: "불법 콘텐츠" }),
      }),
    );
  });

  it("지원 등급은 정지할 수 없고, **거부된 시도도** 로그에 남는다", async () => {
    maybeSingle.mockResolvedValue({
      data: { role: "admin", admin_tier: "support", suspended_at: null },
      error: null,
    });

    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "suspend" }));

    expect(res.status).toBe(403);
    expect(setSuspended).not.toHaveBeenCalled();
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "developer:suspend", succeeded: false }),
    );
  });

  it("자기 자신은 정지할 수 없다 (스스로를 잠그면 풀 사람이 없다)", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "admin-1", action: "suspend" }));

    expect(res.status).toBe(400);
    expect(setSuspended).not.toHaveBeenCalled();
  });

  it("체험 연장도 되고 로그에 남는다", async () => {
    maybeSingle
      .mockResolvedValueOnce({
        data: { role: "admin", admin_tier: "operator", suspended_at: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: { trial_ends_at: "2026-09-20T00:00:00.000Z" }, error: null });

    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "extend_trial" }));

    expect(res.status).toBe(200);
    expect(extendTrial).toHaveBeenCalled();
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "developer:extend_trial" }),
    );
  });

  it("모르는 행위는 400", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "삭제해버리기" }));

    expect(res.status).toBe(400);
  });

  it("감사 로그가 실패해도 행위는 끝내되 응답에 알린다", async () => {
    recordAdminAction.mockResolvedValue({ recorded: false, message: "권한 없음" });

    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "suspend" }));

    expect(res.status).toBe(200);
    expect(setSuspended).toHaveBeenCalled();
    expect((await res.json()).auditWarning).toContain("권한 없음");
  });
});

/**
 * [P8-2c] 등급 부여·한도 지정도 같은 관문·같은 감사 로그를 탄다 (FR-035·036).
 */
describe("[P8-2c] 부여와 한도", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    maybeSingle.mockResolvedValue({
      data: { role: "admin", admin_tier: "super", suspended_at: null },
      error: null,
    });
    grantGrade.mockResolvedValue(undefined);
    setMonthlyLimit.mockResolvedValue(undefined);
    recordAdminAction.mockResolvedValue({ recorded: true });
  });

  it("등급을 기간과 함께 부여하고 로그에 남긴다", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(
      post({
        userId: "user-9",
        action: "grant_grade",
        grade: "basic",
        until: "2026-12-31T00:00:00.000Z",
        reason: "가을 강의",
      }),
    );

    expect(res.status).toBe(200);
    expect(grantGrade).toHaveBeenCalledWith(expect.anything(), "user-9", {
      grade: "basic",
      until: "2026-12-31T00:00:00.000Z",
      reason: "가을 강의",
    });
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "policy:change",
        targetId: "user-9",
        detail: expect.objectContaining({ grade: "basic" }),
      }),
    );
  });

  it("부여 해제는 grade 없이 부른다", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "grant_grade" }));

    expect(res.status).toBe(200);
    expect(grantGrade).toHaveBeenCalledWith(expect.anything(), "user-9", null);
  });

  it("모르는 등급은 400 (아무 등급이나 끼워넣지 못하게)", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "grant_grade", grade: "vip" }));

    expect(res.status).toBe(400);
    expect(grantGrade).not.toHaveBeenCalled();
  });

  it("부여는 정책 변경이라 운영자는 못 한다 (최고관리자만)", async () => {
    maybeSingle.mockResolvedValue({
      data: { role: "admin", admin_tier: "operator", suspended_at: null },
      error: null,
    });

    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "grant_grade", grade: "pro" }));

    expect(res.status).toBe(403);
    expect(grantGrade).not.toHaveBeenCalled();
  });

  it("한도를 지정한다 (0도 그대로)", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "set_limit", limit: 0 }));

    expect(res.status).toBe(200);
    expect(setMonthlyLimit).toHaveBeenCalledWith(expect.anything(), "user-9", 0);
  });

  it("한도를 비우면 등급 기본값으로 되돌린다", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "set_limit", limit: null }));

    expect(res.status).toBe(200);
    expect(setMonthlyLimit).toHaveBeenCalledWith(expect.anything(), "user-9", null);
  });

  it("숫자가 아닌 한도는 400", async () => {
    const { POST } = await import("@/app/api/admin/developers/route");
    const res = await POST(post({ userId: "user-9", action: "set_limit", limit: "많이" }));

    expect(res.status).toBe(400);
    expect(setMonthlyLimit).not.toHaveBeenCalled();
  });
});
