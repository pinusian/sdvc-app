import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P8-5d] /api/reports — 신고 접수 (FR-013·042).
 *
 * 판정(`policy.ts`)은 따로 시험했다. 여기서 볼 것은 **그 판정이 실제로
 * 걸려 있는가**다 — 규칙이 있는 것과 규칙이 지켜지는 것은 다르다(BL-008).
 */

const getUser = vi.fn();
const maybeSingle = vi.fn();
const countOpenReports = vi.fn();
const createReport = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

vi.mock("@/lib/reports/store", () => ({
  countOpenReports: (...a: unknown[]) => countOpenReports(...a),
  createReport: (...a: unknown[]) => createReport(...a),
}));

const post = (body: unknown) =>
  new Request("http://localhost:3000/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const VALID = { category: "bug", body: "대화 중에 화면이 멈춰서 진행되지 않습니다." };

describe("[P8-5d] POST /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "dev-1", email: "dev@example.com" } } });
    maybeSingle.mockResolvedValue({
      data: { email: "dev@example.com", suspended_at: null },
      error: null,
    });
    countOpenReports.mockResolvedValue(0);
    createReport.mockResolvedValue({ id: "rep-1", status: "open" });
  });

  it("로그인하지 않으면 401 — 익명 신고는 받지 않는다(결과를 돌려줘야 한다)", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const { POST } = await import("@/app/api/reports/route");
    const res = await POST(post(VALID));

    expect(res.status).toBe(401);
    expect(createReport).not.toHaveBeenCalled();
  });

  it("제대로 쓴 신고는 접수된다", async () => {
    const { POST } = await import("@/app/api/reports/route");
    const res = await POST(post(VALID));

    expect(res.status).toBe(201);
    expect(createReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reporterId: "dev-1", category: "bug" }),
    );
  });

  it("신고 당시 주소를 함께 남긴다", async () => {
    const { POST } = await import("@/app/api/reports/route");
    await POST(post(VALID));

    expect(createReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reporterEmail: "dev@example.com" }),
    );
  });

  it("내용이 짧으면 400이고 저장하지 않는다", async () => {
    const { POST } = await import("@/app/api/reports/route");
    const res = await POST(post({ category: "bug", body: "이상" }));

    expect(res.status).toBe(400);
    expect(createReport).not.toHaveBeenCalled();
  });

  it("모르는 분류는 400 — 애매하면 막는다", async () => {
    const { POST } = await import("@/app/api/reports/route");
    const res = await POST(post({ category: "해킹", body: "열 자가 넘는 내용입니다." }));

    expect(res.status).toBe(400);
    expect(createReport).not.toHaveBeenCalled();
  });

  it("정지된 계정은 403 — 왜인지 말해준다", async () => {
    maybeSingle.mockResolvedValue({
      data: { email: "dev@example.com", suspended_at: "2026-09-01T00:00:00Z" },
      error: null,
    });

    const { POST } = await import("@/app/api/reports/route");
    const res = await POST(post(VALID));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("정지");
    expect(createReport).not.toHaveBeenCalled();
  });

  it("미처리 신고가 쌓여 있으면 403 — 접수함이 한 사람으로 차지 않게", async () => {
    countOpenReports.mockResolvedValue(5);

    const { POST } = await import("@/app/api/reports/route");
    const res = await POST(post(VALID));

    expect(res.status).toBe(403);
    expect(createReport).not.toHaveBeenCalled();
  });

  it("망가진 본문에도 터지지 않는다", async () => {
    const { POST } = await import("@/app/api/reports/route");
    const res = await POST(
      new Request("http://localhost:3000/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{{{",
      }),
    );

    expect(res.status).toBe(400);
  });
});
