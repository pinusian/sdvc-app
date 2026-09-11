import { describe, expect, it } from "vitest";
import { costUsd, MODEL_PRICING } from "@/lib/usage/pricing";

/**
 * [P6-2] 토큰 사용량 → 원가(달러).
 * 이 값이 [P8-3] 원가 모니터링과 등급별 한도 판단의 근거가 된다.
 */

describe("[P6-2] costUsd", () => {
  it("Sonnet 5 단가로 계산한다 (입력 $2 / 출력 $10 per MTok)", () => {
    // 100만 입력 + 100만 출력 = $2 + $10
    expect(costUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBeCloseTo(12, 6);
    expect(costUsd("claude-sonnet-5", 1_000, 500)).toBeCloseTo(0.002 + 0.005, 6);
  });

  it("Opus 5 단가로 계산한다 (입력 $5 / 출력 $25 per MTok)", () => {
    expect(costUsd("claude-opus-5", 1_000_000, 1_000_000)).toBeCloseTo(30, 6);
  });

  it("모르는 모델은 가장 비싼 단가로 잡는다 (원가를 과소평가하지 않기 위해)", () => {
    const unknown = costUsd("claude-future-9", 1_000_000, 1_000_000);
    const mostExpensive = Math.max(
      ...Object.values(MODEL_PRICING).map((p) => p.inputPerMTok + p.outputPerMTok),
    );
    expect(unknown).toBeCloseTo(mostExpensive, 6);
  });

  it("0 토큰이면 0원", () => {
    expect(costUsd("claude-sonnet-5", 0, 0)).toBe(0);
  });
});
