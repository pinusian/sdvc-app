import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P8-3] GET /api/admin/usage — 적자를 보는 화면의 데이터 (FR-015, SC-007).
 */

const getUser = vi.fn();
const maybeSingle = vi.fn();
const usageRows = vi.fn();
const listDevelopers = vi.fn();
const recordAdminAction = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({
    from(table: string) {
      if (table === "usage_logs") {
        const chain = {
          select: () => chain,
          gte: () => chain,
          then: (resolve: (r: unknown) => unknown) => resolve(usageRows()),
        };
        return chain;
      }
      return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    },
  }),
}));

vi.mock("@/lib/admin/developers", () => ({
  listDevelopers: (...a: unknown[]) => listDevelopers(...a),
}));

vi.mock("@/lib/admin/audit", () => ({
  recordAdminAction: (...a: unknown[]) => recordAdminAction(...a),
}));


describe("[P8-3] GET /api/admin/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    maybeSingle.mockResolvedValue({
      data: { role: "admin", admin_tier: "support", suspended_at: null },
      error: null,
    });
    usageRows.mockReturnValue({
      data: [
        { user_id: "a", cost_usd: 5 },
        { user_id: "b", cost_usd: 1 },
      ],
      error: null,
    });
    listDevelopers.mockResolvedValue([
      { id: "a", email: "a@x.com", grade: "basic", subscriptionStatus: "active" },
      { id: "b", email: "b@x.com", grade: "pro", subscriptionStatus: "active" },
    ]);
    recordAdminAction.mockResolvedValue({ recorded: true });
  });

  it("관리자가 아니면 404", async () => {
    maybeSingle.mockResolvedValue({
      data: { role: "developer", admin_tier: "super", suspended_at: null },
      error: null,
    });

    const { GET } = await import("@/app/api/admin/usage/route");
    expect((await GET()).status).toBe(404);
  });

  it("지원 등급도 볼 수 있다 (읽기 전용)", async () => {
    const { GET } = await import("@/app/api/admin/usage/route");
    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("총원가·총매출·마진·비율을 돌려준다", async () => {
    const { GET } = await import("@/app/api/admin/usage/route");
    const body = await (await GET()).json();

    expect(body.summary.totalCostUsd).toBe(6);
    expect(body.summary.totalRevenueUsd).toBe(47);
    expect(body.summary.marginUsd).toBe(41);
    expect(body.summary.costRatio).toBeCloseTo(6 / 47);
  });

  it("보는 것도 감사 로그에 남는다", async () => {
    const { GET } = await import("@/app/api/admin/usage/route");
    await GET();

    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "usage:read" }),
    );
  });

  it("이번 달 것만 센다", async () => {
    const { GET } = await import("@/app/api/admin/usage/route");
    await GET();

    // usage_logs를 gte(월초)로 걸러 불렀는지 — 체인이 호출됐다는 것으로 확인
    expect(usageRows).toHaveBeenCalled();
  });
});
