import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P8-5d] /api/admin/reports — 접수함 처리 (FR-043·044, FR-016).
 *
 * 이 라우트도 세 가지를 함께 해야 한다: 판정 · 행위 · 감사 로그.
 * 여기에 하나 더 — **가리기(FR-016)는 별도 권한**이다. 신고를 처리할 수
 * 있다고 남의 산출물을 가릴 수 있는 것은 아니다.
 */

const getUser = vi.fn();
const maybeSingle = vi.fn();
const listReports = vi.fn();
const updateReport = vi.fn();
const setProjectBlocked = vi.fn();
const recordAdminAction = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

vi.mock("@/lib/reports/store", () => ({
  listReports: (...a: unknown[]) => listReports(...a),
  updateReport: (...a: unknown[]) => updateReport(...a),
}));

vi.mock("@/lib/projects/store", () => ({
  setProjectBlocked: (...a: unknown[]) => setProjectBlocked(...a),
}));

vi.mock("@/lib/admin/audit", () => ({
  recordAdminAction: (...a: unknown[]) => recordAdminAction(...a),
}));

const get = (query = "") => new Request(`http://localhost:3000/api/admin/reports${query}`);
const post = (body: unknown) =>
  new Request("http://localhost:3000/api/admin/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const asTier = (tier: string) =>
  maybeSingle.mockResolvedValue({
    data: { role: "admin", admin_tier: tier, suspended_at: null },
    error: null,
  });

describe("[P8-5d] /api/admin/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    asTier("super");
    listReports.mockResolvedValue([{ id: "rep-1" }]);
    updateReport.mockResolvedValue({ id: "rep-1", status: "resolved" });
    setProjectBlocked.mockResolvedValue(undefined);
    recordAdminAction.mockResolvedValue({ recorded: true });
  });

  it("관리자가 아니면 404 — 이런 화면이 있다는 것조차 알리지 않는다", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "developer" }, error: null });

    const { GET } = await import("@/app/api/admin/reports/route");
    expect((await GET(get())).status).toBe(404);
    expect(listReports).not.toHaveBeenCalled();
  });

  it("읽으면 감사 로그에 남는다 — 신고 내용은 남의 고발이다", async () => {
    const { GET } = await import("@/app/api/admin/reports/route");
    await GET(get());

    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "report:read" }),
    );
  });

  it("상태로 좁혀 읽는다", async () => {
    const { GET } = await import("@/app/api/admin/reports/route");
    await GET(get("?status=open"));

    expect(listReports).toHaveBeenCalledWith(expect.anything(), { status: "open" });
  });

  it("지원 등급은 읽되 처리하지 못한다", async () => {
    asTier("support");

    const { GET, POST } = await import("@/app/api/admin/reports/route");
    expect((await GET(get())).status).toBe(200);

    const res = await POST(post({ reportId: "rep-1", status: "resolved" }));
    expect(res.status).toBe(403);
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("처리하면 상태·답·처리자가 남고 감사 로그도 남는다", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    const res = await POST(post({ reportId: "rep-1", status: "resolved", adminNote: " 가렸습니다. " }));

    expect(res.status).toBe(200);
    expect(updateReport).toHaveBeenCalledWith(expect.anything(), "rep-1", {
      status: "resolved",
      adminNote: "가렸습니다.",
      handledBy: "admin-1",
    });
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "report:handle" }),
    );
  });

  it("빈 답은 '답 없음'으로 남긴다 — 빈 문자열을 답으로 두지 않는다", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    await POST(post({ reportId: "rep-1", status: "rejected", adminNote: "   " }));

    expect(updateReport).toHaveBeenCalledWith(
      expect.anything(),
      "rep-1",
      expect.objectContaining({ adminNote: null }),
    );
  });

  it("모르는 상태는 400", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    expect((await POST(post({ reportId: "rep-1", status: "대충" }))).status).toBe(400);
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("어느 신고인지 없으면 400", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    expect((await POST(post({ status: "resolved" }))).status).toBe(400);
  });

  it("[FR-016] 처리하면서 산출물을 가릴 수 있다 — 이 배선이 없었다", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    await POST(post({ reportId: "rep-1", status: "resolved", blockProjectId: "proj-7" }));

    expect(setProjectBlocked).toHaveBeenCalledWith(
      expect.anything(),
      "proj-7",
      true,
      expect.stringContaining("신고"),
    );
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "artifact:block", targetId: "proj-7" }),
    );
  });

  it("가리기를 풀 수도 있다 — 오판했으면 되돌린다", async () => {
    const { POST } = await import("@/app/api/admin/reports/route");
    await POST(
      post({ reportId: "rep-1", status: "rejected", blockProjectId: "proj-7", blocked: false }),
    );

    expect(setProjectBlocked).toHaveBeenCalledWith(expect.anything(), "proj-7", false, null);
  });

  it("가릴 권한이 없으면 가리지도, 신고를 닫지도 않는다", async () => {
    // operator는 report:handle은 되지만 artifact:block도 된다 →
    // 권한이 갈리는 조합을 위해 artifact:block이 없는 등급을 흉내 낸다
    asTier("support");

    const { POST } = await import("@/app/api/admin/reports/route");
    const res = await POST(post({ reportId: "rep-1", status: "resolved", blockProjectId: "proj-7" }));

    expect(res.status).toBe(403);
    expect(setProjectBlocked).not.toHaveBeenCalled();
    expect(updateReport).not.toHaveBeenCalled();
  });
});
