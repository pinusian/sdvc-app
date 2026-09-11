/**
 * [P6-2] 모델별 단가 (USD / 100만 토큰).
 *
 * 등급별 한도(FR-026)와 원가 모니터링([P8-3])의 근거 값이다.
 * 단가가 바뀌면 여기만 고치되, **과거 기록의 원가는 다시 계산하지 않는다**
 * (그때의 단가로 이미 저장해 두었다 — `usage_logs.cost_usd`).
 */
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
};

const PER_MTOK = 1_000_000;

/**
 * 사용량을 달러로 환산한다.
 * 모르는 모델이면 **가장 비싼 단가**로 잡는다 — 원가를 낮게 잡으면
 * 한도를 넘겨 쓰게 두는 셈이라 적자가 난다.
 */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? mostExpensive();
  return (
    (inputTokens / PER_MTOK) * pricing.inputPerMTok +
    (outputTokens / PER_MTOK) * pricing.outputPerMTok
  );
}

function mostExpensive() {
  return Object.values(MODEL_PRICING).reduce((worst, pricing) =>
    pricing.inputPerMTok + pricing.outputPerMTok > worst.inputPerMTok + worst.outputPerMTok
      ? pricing
      : worst,
  );
}
