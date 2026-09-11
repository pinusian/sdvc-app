import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "@/lib/billing/webhook";

/**
 * [P6-6] 웹훅 서명 검증 — 이 파일이 돈을 지킨다.
 *
 * 검증이 없으면 누구나 "결제됐어요" 요청을 보내 **무료로 프로 등급**을
 * 받아갈 수 있다. Stripe가 보낸 것이 맞는지 암호 서명으로 확인한다.
 */

const SECRET = "whsec_test_secret";

function sign(payload: string, timestampSec: number, secret = SECRET) {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSec}.${payload}`)
    .digest("hex");
  return `t=${timestampSec},v1=${signature}`;
}

const NOW = new Date("2026-09-12T00:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

describe("[P6-6] verifyStripeSignature", () => {
  it("Stripe가 보낸 올바른 서명은 통과시킨다", () => {
    const payload = '{"type":"checkout.session.completed"}';
    expect(verifyStripeSignature(payload, sign(payload, NOW_SEC), SECRET, NOW)).toBe(true);
  });

  it("다른 비밀키로 서명한 것은 막는다", () => {
    const payload = '{"type":"checkout.session.completed"}';
    const forged = sign(payload, NOW_SEC, "whsec_attacker");
    expect(verifyStripeSignature(payload, forged, SECRET, NOW)).toBe(false);
  });

  it("내용이 한 글자라도 바뀌면 막는다", () => {
    const payload = '{"amount":1200}';
    const header = sign(payload, NOW_SEC);
    expect(verifyStripeSignature('{"amount":9900}', header, SECRET, NOW)).toBe(false);
  });

  it("오래된 서명은 막는다 (재전송 공격 방지)", () => {
    const payload = "{}";
    const old = sign(payload, NOW_SEC - 60 * 60); // 1시간 전
    expect(verifyStripeSignature(payload, old, SECRET, NOW)).toBe(false);
  });

  it("형식이 깨진 헤더는 막는다", () => {
    const payload = "{}";
    for (const header of ["", "garbage", "t=abc,v1=xyz", `v1=${"0".repeat(64)}`, null]) {
      expect(verifyStripeSignature(payload, header as never, SECRET, NOW), String(header)).toBe(
        false,
      );
    }
  });

  it("비밀키가 없으면 막는다 (설정 실수로 열리면 안 된다)", () => {
    const payload = "{}";
    expect(verifyStripeSignature(payload, sign(payload, NOW_SEC), "", NOW)).toBe(false);
  });
});
