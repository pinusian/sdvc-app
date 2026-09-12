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

/**
 * [P8-2b][P8-4a] 부여·한도까지 함께 읽어온다 (FR-035·036).
 * 판정은 `canStartChat` 한 곳에서 하므로, 여기서는 **빠짐없이 넘기는 것**이 일이다.
 */
describe("[P8-2b] 부여·한도 읽기", () => {
  it("부여 등급·만료일·계정 한도를 함께 넘긴다", async () => {
    monthlyTokenUsage.mockResolvedValue(0);
    const client = fakeSupabase(
      {
        grade: "trial",
        subscription_status: "none",
        trial_ends_at: "2026-09-01T00:00:00.000Z",
        suspended_at: null,
        granted_grade: "basic",
        granted_until: "2026-12-31T00:00:00.000Z",
        monthly_token_limit: 300000,
      },
      0,
    );

    const state = await loadAccountState(client, "user-1");

    expect(state).toMatchObject({
      grantedGrade: "basic",
      grantedUntil: "2026-12-31T00:00:00.000Z",
      monthlyTokenLimit: 300000,
    });
  });

  it("한도 0을 null로 바꾸지 않는다 (0은 완전 차단이다)", async () => {
    monthlyTokenUsage.mockResolvedValue(0);
    const client = fakeSupabase(
      {
        grade: "basic",
        subscription_status: "active",
        trial_ends_at: null,
        suspended_at: null,
        granted_grade: null,
        granted_until: null,
        monthly_token_limit: 0,
      },
      0,
    );

    const state = await loadAccountState(client, "user-1");

    expect(state?.monthlyTokenLimit).toBe(0);
  });
});
