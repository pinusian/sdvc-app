import { GRADE_LIMITS, type Grade } from "@/lib/billing/access";

/**
 * [P6-8] 화면에 보여줄 요금제 설명.
 *
 * 한도 숫자는 [P6-3]의 `GRADE_LIMITS` 하나만 본다 — 값을 여기 또 적으면
 * 판정과 안내가 어긋나서 "된다고 했는데 막힌다"가 생긴다.
 *
 * 통화는 게이트 G2에서 달러로 정했다(FR-028).
 */

export interface Plan {
  grade: Grade;
  title: string;
  /** 화면에 그대로 쓰는 가격 표기 */
  price: string;
  period: string;
  summary: string;
  features: string[];
  /** 결제 API에 보낼 이름. 체험은 살 수 없으므로 없다. */
  planId?: "basic" | "pro";
}

/**
 * 등급별 월 요금(USD). **여기가 유일한 출처다** — 요금제 화면과 원가 계산
 * ([P8-3])이 각자 숫자를 들고 있으면 언젠가 어긋나고, 그때 마진이 거짓말을 한다.
 */
export const GRADE_PRICE_USD: Record<Grade, number> = {
  trial: 0,
  basic: 12,
  pro: 35,
};

/** 50만 → "50만", 200만 → "200만" (IT를 잘 모르는 사람도 읽히게) */
export function formatTokens(tokens: number): string {
  if (tokens >= 100_000_000) return `${tokens / 100_000_000}억`;
  if (tokens >= 10_000) return `${Math.round(tokens / 10_000)}만`;
  return tokens.toLocaleString("ko-KR");
}

function limitsOf(grade: Grade): string[] {
  const { projects, monthlyTokens } = GRADE_LIMITS[grade];
  return [`프로젝트 ${projects}개`, `월 ${formatTokens(monthlyTokens)} 토큰`];
}

export const PLANS: Plan[] = [
  {
    grade: "trial",
    title: "체험",
    price: "무료",
    period: "7일",
    summary: "먼저 만들어보고 결정하세요.",
    features: [...limitsOf("trial"), "5단계 대화 전 과정", "만든 홈페이지 공개"],
  },
  {
    grade: "basic",
    title: "기본",
    price: `$${GRADE_PRICE_USD.basic}`,
    period: "월",
    summary: "혼자 쓰는 홈페이지 한두 개에 알맞습니다.",
    features: [...limitsOf("basic"), "만든 뒤 수정·기능 추가", "이메일 문의"],
    planId: "basic",
  },
  {
    grade: "pro",
    title: "프로",
    price: `$${GRADE_PRICE_USD.pro}`,
    period: "월",
    summary: "여러 프로젝트를 계속 손보는 분께.",
    features: [...limitsOf("pro"), "기본의 모든 기능", "우선 문의"],
    planId: "pro",
  },
];
