import { describe, expect, it } from "vitest";
import { SITE_SESSION_COOKIE, readSiteSessionCookie } from "@/lib/site-accounts/cookie";

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
