import { describe, expect, it, vi } from "vitest";

/**
 * [P6-4] 판정에 필요한 계정 상태 읽기.
 * 프로필(등급·구독·체험만료) + 이번 달 사용량 + 프로젝트 수를 한 번에 모은다.
 */

const monthlyTokenUsage = vi.fn();
vi.mock("@/lib/usage/store", () => ({
  monthlyTokenUsage: (...args: unknown[]) => monthlyTokenUsage(...args),
}));

const { loadAccountState } = await import("@/lib/billing/account");

function fakeSupabase(profile: unknown, projectCount: number | null, profileError: unknown = null) {
  const client = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: profile, error: profileError }) }),
          }),
        };
      }
      // projects — 개수만 센다
      return {
        select: () => ({ eq: async () => ({ count: projectCount, error: null }) }),
      };
    },
  };
  return client as never;
}

describe("[P6-4] loadAccountState", () => {
  it("프로필·사용량·프로젝트 수를 모아서 돌려준다", async () => {
    monthlyTokenUsage.mockResolvedValue(1_234);
    const client = fakeSupabase(
      {
        grade: "basic",
        subscription_status: "active",
        trial_ends_at: "2026-09-18T00:00:00Z",
      },
      2,
    );

    expect(await loadAccountState(client, "user-1")).toEqual({
      grade: "basic",
      subscriptionStatus: "active",
      trialEndsAt: "2026-09-18T00:00:00Z",
      monthlyTokensUsed: 1_234,
      projectCount: 2,
    });
  });

  it("프로필이 없으면 null을 준다 (판단 근거가 없으므로 부르는 쪽이 막는다)", async () => {
    monthlyTokenUsage.mockResolvedValue(0);
    expect(await loadAccountState(fakeSupabase(null, 0), "user-1")).toBeNull();
  });

  it("프로젝트 수를 못 세면 0이 아니라 막히도록 크게 잡는다", async () => {
    // 셀 수 없는데 0으로 치면 한도가 무력화된다 — 안전한 쪽으로 틀린다.
    monthlyTokenUsage.mockResolvedValue(0);
    const state = await loadAccountState(
      fakeSupabase({ grade: "trial", subscription_status: "none", trial_ends_at: null }, null),
      "user-1",
    );
    expect(state?.projectCount).toBeGreaterThan(1000);
  });
});
