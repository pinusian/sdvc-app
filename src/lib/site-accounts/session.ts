import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * [P11-2] 사용자(방문자) 세션.
 *
 * 개발자 계정은 Supabase Auth가 세션을 관리하지만, 사용자(방문자)는
 * 완전히 별도 체계라([P11-1]) 직접 서명한 쿠키 토큰으로 "누구인지"를
 * 증명한다. HMAC-SHA256이라 이 서버만 서명·검증할 수 있다 — 위조하려면
 * SITE_SESSION_SECRET을 알아야 하는데, 그건 서버에만 있다.
 *
 * `SITE_API_KEY_ENCRYPTION_SECRET`과 일부러 다른 비밀값을 쓴다 — 용도가
 * 다른 비밀값을 섞으면 하나가 새면 둘 다 샌다([P11-1]의 같은 원칙).
 */

export interface SiteSessionPayload {
  siteUserId: string;
  projectId: string;
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30일

function secret(): string {
  const value = process.env.SITE_SESSION_SECRET;
  if (!value) {
    throw new Error("SITE_SESSION_SECRET이 설정되지 않았습니다. 세션을 서명할 수 없습니다.");
  }
  return value;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function signSiteSession(payload: SiteSessionPayload): string {
  const body = JSON.stringify({ ...payload, iat: Date.now() });
  const payloadB64 = Buffer.from(body, "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySiteSession(token: string): SiteSessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  let expectedSig: string;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return null; // SITE_SESSION_SECRET이 없는 환경 — 안전하게 거부한다.
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      siteUserId?: unknown;
      projectId?: unknown;
      iat?: unknown;
    };
    if (typeof parsed.siteUserId !== "string" || typeof parsed.projectId !== "string") return null;
    if (typeof parsed.iat !== "number" || Date.now() - parsed.iat > MAX_AGE_MS) return null;

    return { siteUserId: parsed.siteUserId, projectId: parsed.projectId };
  } catch {
    return null;
  }
}
