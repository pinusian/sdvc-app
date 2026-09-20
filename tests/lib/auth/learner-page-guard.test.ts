import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireLearnerAccess, redirect } = vi.hoisted(() => ({
  requireLearnerAccess: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth/learner-route-guard", () => ({ requireLearnerAccess }));
vi.mock("next/navigation", () => ({ redirect }));

describe("[T016] 수강생 보호 페이지 공통 가드", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("활성 수강생에게 검증된 사용자를 돌려준다", async () => {
    const user = { id: "learner-1", email: "learner@example.com" };
    requireLearnerAccess.mockResolvedValue({ ok: true, user });
    const { requireLearnerPageAccess } = await import("@/lib/auth/learner-page-guard");

    await expect(requireLearnerPageAccess()).resolves.toBe(user);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("비로그인 사용자를 로그인 화면으로 보낸다", async () => {
    requireLearnerAccess.mockResolvedValue({
      ok: false,
      status: 401,
      code: "unauthenticated",
      response: new Response(null, { status: 401 }),
    });
    const { requireLearnerPageAccess } = await import("@/lib/auth/learner-page-guard");

    await expect(requireLearnerPageAccess()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("정지·비활성 수강생을 전용 안내 화면으로 보낸다", async () => {
    requireLearnerAccess.mockResolvedValue({
      ok: false,
      status: 403,
      code: "account_suspended",
      response: new Response(null, { status: 403 }),
    });
    const { requireLearnerPageAccess } = await import("@/lib/auth/learner-page-guard");

    await expect(requireLearnerPageAccess()).rejects.toThrow(
      "NEXT_REDIRECT:/account-restricted",
    );
    expect(redirect).toHaveBeenCalledWith("/account-restricted");
  });
});

describe("[T016] 보호 화면 배선", () => {
  it.each([
    "src/app/dashboard/page.tsx",
    "src/app/conversations/[id]/page.tsx",
  ])("%s가 페이지 공통 가드를 호출한다", (page) => {
    const source = readFileSync(resolve(process.cwd(), page), "utf8");
    expect(source).toContain('from "@/lib/auth/learner-page-guard"');
    expect(source).toContain("await requireLearnerPageAccess()");
  });

  it("제한 안내 페이지는 로그인한 본인의 id로만 프로필을 조회한다", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(auth)/account-restricted/page.tsx"),
      "utf8",
    );
    expect(source).toContain("loadLearnerProfile(user.id)");
    expect(source).not.toContain("searchParams");
  });

  it("공통 프로필 로더가 전달받은 사용자 id로만 최신 상태를 조회한다", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/auth/learner-profile.ts"),
      "utf8",
    );
    expect(source).toContain('.eq("id", userId)');
    expect(source).toContain("suspendedReason: row.suspended_reason");
  });
});
