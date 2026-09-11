import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * [P6-7b] GET /api/cron/lifecycle — 하루 한 번 도는 정리 작업.
 * 누구나 부를 수 있으면 안 되므로 비밀 열쇠로 막는다.
 */

const runLifecycleSweep = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/billing/purge", () => ({
  runLifecycleSweep: (...args: unknown[]) => runLifecycleSweep(...args),
}));

function request(secret?: string) {
  return new Request("http://localhost:3000/api/cron/lifecycle", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("[P6-7b] GET /api/cron/lifecycle", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    runLifecycleSweep.mockResolvedValue({ locked: 1, purgedProjects: 2, failed: 0 });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("열쇠가 맞으면 정리하고 결과를 알려준다", async () => {
    const { GET } = await import("@/app/api/cron/lifecycle/route");
    const res = await GET(request("cron-secret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locked: 1, purgedProjects: 2, failed: 0 });
    expect(runLifecycleSweep).toHaveBeenCalled();
  });

  it("열쇠가 없거나 틀리면 401이고 아무것도 하지 않는다", async () => {
    const { GET } = await import("@/app/api/cron/lifecycle/route");

    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(runLifecycleSweep).not.toHaveBeenCalled();
  });

  it("서버에 열쇠 설정이 없으면 잠가둔다 (열린 채로 두지 않는다)", async () => {
    delete process.env.CRON_SECRET;

    const { GET } = await import("@/app/api/cron/lifecycle/route");
    const res = await GET(request("anything"));

    expect(res.status).toBe(500);
    expect(runLifecycleSweep).not.toHaveBeenCalled();
  });
});
