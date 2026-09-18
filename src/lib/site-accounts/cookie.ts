/**
 * [P11-2] 사용자(방문자) 세션 쿠키 이름·옵션을 한 곳에 모은다.
 *
 * `path`를 그 프로젝트 주소(`/site/{slug}`)로 한정하는 게 핵심이다 —
 * 한정하지 않으면 브라우저 하나가 여러 산출물을 열어봤을 때 세션이 서로
 * 덮어써진다(이 브라우저 도구가 탭마다 쿠키를 공유해 실제로 겪은 문제와
 * 같은 부류 — 여기서는 프로젝트 단위로 미리 막아둔다).
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
    path: `/site/${slug}`,
    maxAge: MAX_AGE_SECONDS,
  };
}
