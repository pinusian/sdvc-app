import { describe, expect, it } from "vitest";
import {
  SITE_SESSION_COOKIE,
  readSiteSessionCookie,
  siteSessionCookieOptions,
} from "@/lib/site-accounts/cookie";

/**
 * [P11-3] 기록 API가 요청마다 이 쿠키를 읽어야 한다. Route Handler에서
 * `Request`를 그대로 받으므로, `next/headers`의 `cookies()`를 목(mock)하는
 * 대신 `Cookie` 헤더를 직접 파싱한다 — 테스트도 실제 요청도 같은 경로를 탄다.
 */

function requestWithCookie(header: string | null) {
  const headers = new Headers();
  if (header !== null) headers.set("cookie", header);
  return new Request("http://localhost:3000/api/site/x/records", { headers });
}

describe("[P11-3] readSiteSessionCookie", () => {
  it("세션 쿠키 값을 꺼낸다", () => {
    const req = requestWithCookie(`${SITE_SESSION_COOKIE}=abc.def`);
    expect(readSiteSessionCookie(req)).toBe("abc.def");
  });

  it("다른 쿠키들 사이에 섞여 있어도 찾는다", () => {
    const req = requestWithCookie(`foo=bar; ${SITE_SESSION_COOKIE}=abc.def; baz=qux`);
    expect(readSiteSessionCookie(req)).toBe("abc.def");
  });

  it("쿠키 헤더 자체가 없으면 null이다", () => {
    expect(readSiteSessionCookie(requestWithCookie(null))).toBeNull();
  });

  it("이 쿠키가 없으면 null이다 (다른 쿠키만 있어도)", () => {
    const req = requestWithCookie("foo=bar");
    expect(readSiteSessionCookie(req)).toBeNull();
  });

  it("URL 인코딩된 값은 복원해서 돌려준다", () => {
    const req = requestWithCookie(`${SITE_SESSION_COOKIE}=abc%2Edef`);
    expect(readSiteSessionCookie(req)).toBe("abc.def");
  });
});

/**
 * [BL-026] 쿠키의 `path`가 실제로 이 쿠키를 읽는 라우트와 어긋나 있었다.
 *
 * 가입·로그인 응답은 쿠키를 `/site/{slug}`로 한정해 심었는데, 이 쿠키를
 * 실제로 읽는 곳은 전부 `/api/site/{slug}/...`(기록·API 키·AI 요약)다.
 * 브라우저는 쿠키의 Path가 요청 URL의 **접두사**일 때만 그 쿠키를 실어
 * 보내는데, `/site/{slug}`는 `/api/site/{slug}/...`의 접두사가 아니다 —
 * 그래서 실제 브라우저에서는 로그인 직후를 빼고는 이 쿠키가 단 한 번도
 * 전송되지 않았다. 실사용자가 로그인 후 API 키 저장에서 "로그인이
 * 필요합니다"를 그대로 겪었다(2026-09-18) — 로그인 화면이 바뀐 건 응답
 * 본문(email 등)으로 낙관적으로 전환됐을 뿐, 그 뒤 어떤 요청도 실제로는
 * 인증되지 않고 있었다.
 *
 * 이 어긋남을 잡을 수 있었던 유일한 검사가 바로 이 값인데, 지금까지 아무
 * 테스트도 `siteSessionCookieOptions`의 `path`를 확인하지 않았다 —
 * `readSiteSessionCookie`는 `Cookie` 헤더를 직접 파싱해 테스트하므로
 * (브라우저의 Path 매칭을 거치지 않는다), 값만 맞으면 그 어긋남이
 * 드러나지 않았다.
 */
describe("[BL-026] siteSessionCookieOptions — path가 실제로 쿠키를 읽는 라우트와 맞아야 한다", () => {
  it("path는 /site/{slug}가 아니라 /api/site/{slug}다 (그 쿠키를 읽는 라우트가 거기 있다)", () => {
    expect(siteSessionCookieOptions("story-doing").path).toBe("/api/site/story-doing");
  });

  it("httpOnly·sameSite=lax·30일 만료는 그대로다", () => {
    const opts = siteSessionCookieOptions("story-doing");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.maxAge).toBe(30 * 24 * 60 * 60);
  });
});
