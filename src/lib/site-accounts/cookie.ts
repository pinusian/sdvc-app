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

export function siteSessionCookieOptions(slug: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: `/site/${slug}`,
    maxAge: MAX_AGE_SECONDS,
  };
}
