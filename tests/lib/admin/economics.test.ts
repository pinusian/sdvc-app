import { describe, expect, it } from "vitest";
import { summarizeEconomics, GRADE_PRICE_USD } from "@/lib/admin/economics";

/**
 * [P8-3] 적자를 보는 데 필요한 만큼 (FR-015, SC-007).
 *
 * 알고 싶은 것은 하나다: **지금 적자인가.**
 * 요금 대비 API 원가 비율이 100%를 넘으면 팔수록 손해다.
 */

const rows = [
  { user_id: "a", cost_usd: 3.5 },
  { user_id: "a", cost_usd: 1.5 },
  { user_id: "b", cost_usd: 0.25 },
];

const accounts = [
  { id: "a", email: "heavy@example.com", grade: "basic", subscriptionStatus: "active" },
  { id: "b", email: "light@example.com", grade: "pro", subscriptionStatus: "active" },
  { id: "c", email: "trial@example.com", grade: "trial", subscriptionStatus: "none" },
];

describe("[P8-3] summarizeEconomics", () => {
  it("등급별 월 요금은 요금제와 같은 값을 쓴다", () => {
    expect(GRADE_PRICE_USD).toEqual({ trial: 0, basic: 12, pro: 35 });
  });

  it("이번 달 총원가·총매출·마진을 낸다", () => {
    const summary = summarizeEconomics({ usage: rows, accounts });

    expect(summary.totalCostUsd).toBeCloseTo(5.25);
    // 결제 중인 사람만 매출이다 — 체험은 0
    expect(summary.totalRevenueUsd).toBe(47);
    expect(summary.marginUsd).toBeCloseTo(41.75);
  });

  it("요금 대비 원가 비율을 낸다 (SC-007)", () => {
    const summary = summarizeEconomics({ usage: rows, accounts });

    expect(summary.costRatio).toBeCloseTo(5.25 / 47);
  });

  it("매출이 0이면 비율은 null (0으로 나누지 않는다)", () => {
    const summary = summarizeEconomics({
      usage: [{ user_id: "c", cost_usd: 0.1 }],
      accounts: [accounts[2]],
    });

    expect(summary.totalRevenueUsd).toBe(0);
    expect(summary.costRatio).toBeNull();
  });

  it("원가가 큰 사람부터 줄세운다 (누가 적자를 만드는지 바로 보이게)", () => {
    const summary = summarizeEconomics({ usage: rows, accounts });

    expect(summary.byDeveloper.map((d) => d.email)).toEqual([
      "heavy@example.com",
      "light@example.com",
    ]);
    expect(summary.byDeveloper[0].costUsd).toBeCloseTo(5);
  });

  it("사람마다 자기 요금 대비 원가를 낸다 — 한 사람만 적자일 수 있다", () => {
    const summary = summarizeEconomics({ usage: rows, accounts });

    const heavy = summary.byDeveloper[0];
    expect(heavy.priceUsd).toBe(12);
    expect(heavy.costRatio).toBeCloseTo(5 / 12);
  });

  it("쓴 적 없는 사람은 목록에 넣지 않는다 (빈 줄이 화면을 덮는다)", () => {
    const summary = summarizeEconomics({ usage: rows, accounts });

    expect(summary.byDeveloper.some((d) => d.email === "trial@example.com")).toBe(false);
  });

  it("모르는 등급은 매출 0으로 센다 (없는 돈을 있다고 세지 않는다)", () => {
    const summary = summarizeEconomics({
      usage: [],
      accounts: [{ id: "x", email: "x@x.com", grade: "vip", subscriptionStatus: "active" }],
    });

    expect(summary.totalRevenueUsd).toBe(0);
  });
});
