import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const createAdminClient = vi.fn(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle })),
    })),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient,
}));

// tests/setup.ts의 기존 라우트용 활성 수강생 목 대신 실제 어댑터를 검증한다.
vi.unmock("@/lib/auth/learner-route-guard");

const ACTIVE_PROFILE = {
  role: "developer",
  is_active: true,
  suspended_at: null,
  suspended_reason: null,
};

describe("[T015] Next.js 수강생 Route Handler 공통 가드", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "learner-1", email: "learner@example.com" } } });
    maybeSingle.mockResolvedValue({ data: ACTIVE_PROFILE, error: null });
  });

  it("검증된 사용자와 최신 활성 프로필을 결합해 통과시킨다", async () => {
    const { requireLearnerAccess } = await import("@/lib/auth/learner-route-guard");

    const result = await requireLearnerAccess();

    expect(result).toMatchObject({ ok: true, user: { id: "learner-1" } });
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("로그인하지 않은 요청은 프로필을 읽지 않고 401로 거부한다", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { requireLearnerAccess } = await import("@/lib/auth/learner-route-guard");

    const result = await requireLearnerAccess();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denied result");
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toMatchObject({ code: "unauthenticated" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("기존 세션 사용자가 현재 차단 상태면 Route Handler 입구에서 403으로 거부한다", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...ACTIVE_PROFILE, suspended_at: "2026-09-20T00:00:00.000Z" },
      error: null,
    });
    const { requireLearnerAccess } = await import("@/lib/auth/learner-route-guard");

    const result = await requireLearnerAccess();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denied result");
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: "계정 이용이 제한되었습니다.",
      code: "account_suspended",
    });
  });
});

describe("[T015] 보호 API 배선", () => {
  const protectedRoutes = [
    "src/app/api/attachments/route.ts",
    "src/app/api/billing/checkout/route.ts",
    "src/app/api/billing/portal/route.ts",
    "src/app/api/chat/route.ts",
    "src/app/api/conversations/route.ts",
    "src/app/api/conversations/[id]/route.ts",
    "src/app/api/projects/[id]/route.ts",
    "src/app/api/projects/[id]/rollback/route.ts",
    "src/app/api/projects/[id]/site-login/route.ts",
    "src/app/api/projects/[id]/site-users/route.ts",
    "src/app/api/projects/[id]/site-users/[siteUserId]/records/route.ts",
    "src/app/api/projects/[id]/site-users/[siteUserId]/suspend/route.ts",
    "src/app/api/projects/[id]/site-users/[siteUserId]/unsuspend/route.ts",
    "src/app/api/projects/[id]/visibility/route.ts",
    "src/app/api/reports/route.ts",
  ];

  it.each(protectedRoutes)("%s가 공통 가드를 호출한다", (route) => {
    const source = readFileSync(resolve(process.cwd(), route), "utf8");
    expect(source).toContain('from "@/lib/auth/learner-route-guard"');
    expect(source).toContain("await requireLearnerAccess()");
  });
});
