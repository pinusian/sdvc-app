/**
 * [P11-2] 사용자(방문자) 세션 쿠키 이름·옵션을 한 곳에 모은다.
 *
 * `path`를 그 프로젝트 단위로 한정하는 게 핵심이다 — 한정하지 않으면
 * 브라우저 하나가 여러 산출물을 열어봤을 때 세션이 서로 덮어써진다.
 *
 * [BL-026] 처음엔 `/site/{slug}`(그 프로젝트의 **페이지** 주소)로
 * 한정했었다. 그런데 이 쿠키를 실제로 읽는 곳은 전부
 * `/api/site/{slug}/...`(기록·API 키·AI 요약) — 페이지 주소가 아니라
 * **API** 주소다. 브라우저는 쿠키의 Path가 요청 URL의 접두사일 때만
 * 그 쿠키를 실어 보내는데, `/site/{slug}`는 `/api/site/{slug}/...`의
 * 접두사가 아니어서 실제 브라우저에서는 로그인 직후를 빼고는 이 쿠키가
 * 단 한 번도 전송되지 않았다 — 실사용자가 로그인 후 API 키 저장에서
 * "로그인이 필요합니다"를 그대로 겪었다(2026-09-18).
 */

export const SITE_SESSION_COOKIE = "sdvc_site_session";

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // session.ts의 30일과 맞춘다

/**
 * [P11-3] 기록 API가 요청마다 이걸로 세션 토큰을 꺼낸다. `next/headers`의
 * `cookies()`를 목(mock)하는 대신 `Request`의 `Cookie` 헤더를 직접 읽는다 —
 * 테스트도 실제 요청도 같은 경로를 탄다.
 */
export function readSiteSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SITE_SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function siteSessionCookieOptions(slug: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: `/api/site/${slug}`,
    maxAge: MAX_AGE_SECONDS,
  };
}
