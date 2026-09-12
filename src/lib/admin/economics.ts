/**
 * [P8-3] 적자를 보는 데 필요한 만큼 (FR-015, SC-007).
 *
 * 알고 싶은 것은 하나다: **지금 적자인가.**
 * 요금 대비 API 원가 비율이 100%를 넘으면 팔수록 손해다. 그래프보다
 * 이 숫자 몇 개가 먼저다 — 데이터가 쌓이면 그때 그림을 붙인다(Clarify 21).
 *
 * 값은 DB에 이미 있는 것만 쓴다: `usage_logs.cost_usd`(그때 단가로 계산해
 * 저장해 둔 값, [P6-2])와 `profiles.grade`.
 */

/**
 * 등급별 월 요금(USD)은 요금제 화면과 **같은 출처**를 쓴다([P6-8] plans.ts).
 * 각자 숫자를 들고 있으면 언젠가 어긋나고, 그때 마진이 거짓말을 한다.
 */
export { GRADE_PRICE_USD } from "@/lib/billing/plans";
import { GRADE_PRICE_USD as PRICES } from "@/lib/billing/plans";

export interface UsageRow {
  user_id: string;
  cost_usd: number | string | null;
}

export interface AccountRow {
  id: string;
  email: string;
  grade: string;
  subscriptionStatus: string;
}

export interface DeveloperEconomics {
  id: string;
  email: string;
  grade: string;
  costUsd: number;
  /** 이 사람에게서 받는 월 요금 */
  priceUsd: number;
  /** 요금 대비 원가. 요금이 0이면 null */
  costRatio: number | null;
}

export interface EconomicsSummary {
  totalCostUsd: number;
  totalRevenueUsd: number;
  marginUsd: number;
  /** 전체 요금 대비 원가 (SC-007). 매출이 0이면 null */
  costRatio: number | null;
  /** 원가가 큰 사람부터 */
  byDeveloper: DeveloperEconomics[];
}

function toNumber(value: number | string | null): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** 매출은 **결제 중인 사람**만 센다. 체험·해지는 0이다. */
function priceOf(account: AccountRow): number {
  if (account.subscriptionStatus !== "active") return 0;
  // 모르는 등급은 0으로 센다 — 없는 돈을 있다고 세면 적자를 못 본다.
  return PRICES[account.grade as keyof typeof PRICES] ?? 0;
}

export function summarizeEconomics({
  usage,
  accounts,
}: {
  usage: UsageRow[];
  accounts: AccountRow[];
}): EconomicsSummary {
  const costByUser = new Map<string, number>();
  for (const row of usage) {
    costByUser.set(row.user_id, (costByUser.get(row.user_id) ?? 0) + toNumber(row.cost_usd));
  }

  const totalCostUsd = [...costByUser.values()].reduce((sum, cost) => sum + cost, 0);
  const totalRevenueUsd = accounts.reduce((sum, account) => sum + priceOf(account), 0);

  const byDeveloper: DeveloperEconomics[] = accounts
    // 쓴 적 없는 사람은 넣지 않는다 — 빈 줄이 화면을 덮는다.
    .filter((account) => costByUser.has(account.id))
    .map((account) => {
      const costUsd = costByUser.get(account.id) ?? 0;
      const priceUsd = priceOf(account);
      return {
        id: account.id,
        email: account.email,
        grade: account.grade,
        costUsd,
        priceUsd,
        costRatio: priceUsd > 0 ? costUsd / priceUsd : null,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    totalCostUsd,
    totalRevenueUsd,
    marginUsd: totalRevenueUsd - totalCostUsd,
    costRatio: totalRevenueUsd > 0 ? totalCostUsd / totalRevenueUsd : null,
    byDeveloper,
  };
}
