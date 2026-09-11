import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * [P6-6] Stripe 웹훅 서명 검증 — 이 함수가 돈을 지킨다.
 *
 * 검증이 없으면 누구나 "결제됐어요" 요청을 보내 무료로 상위 등급을 받아간다.
 * Stripe는 `stripe-signature: t=<시각>,v1=<서명>` 헤더를 보내고,
 * 서명은 `HMAC-SHA256("<시각>.<본문>", 웹훅비밀키)`다.
 *
 * **본문은 파싱하기 전의 원문 그대로** 넣어야 한다 — JSON을 다시 문자열로
 * 만들면 공백·순서가 달라져 서명이 맞지 않는다.
 */

/** 이 시간(초)보다 오래된 서명은 재전송 공격으로 보고 거절한다. */
const TOLERANCE_SECONDS = 5 * 60;

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): boolean {
  if (!secret || !signatureHeader) return false;

  const parsed = parseHeader(signatureHeader);
  if (!parsed) return false;

  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - parsed.timestamp);
  if (ageSeconds > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${payload}`)
    .digest("hex");

  // 길이가 다르면 timingSafeEqual이 던지므로 먼저 확인한다.
  if (expected.length !== parsed.signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.signature));
}

function parseHeader(header: string): { timestamp: number; signature: string } | null {
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (!key || !value) continue;
    if (key.trim() === "t") {
      const parsedTime = Number.parseInt(value.trim(), 10);
      if (!Number.isFinite(parsedTime)) return null;
      timestamp = parsedTime;
    } else if (key.trim() === "v1" && !signature) {
      signature = value.trim();
    }
  }

  if (timestamp === null || !signature) return null;
  return { timestamp, signature };
}
