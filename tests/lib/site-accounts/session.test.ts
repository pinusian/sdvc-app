import { describe, expect, it, afterEach, vi } from "vitest";
import { signSiteSession, verifySiteSession } from "@/lib/site-accounts/session";

/**
 * [P11-2] 사용자(방문자) 세션 — Supabase Auth를 쓰지 않으므로(개발자 계정과
 * 분리하기 위해, [P2-9] 이메일 인증 한도 재발 방지) 직접 서명한 쿠키 토큰으로
 * "이 사람이 누구인지"를 증명한다. HMAC이므로 이 서버만 서명·검증할 수 있고,
 * 위조하려면 SITE_SESSION_SECRET을 알아야 한다.
 */

describe("[P11-2] signSiteSession / verifySiteSession", () => {
  const originalEnv = process.env.SITE_SESSION_SECRET;
  afterEach(() => {
    process.env.SITE_SESSION_SECRET = originalEnv;
    vi.useRealTimers();
  });

  it("서명한 토큰을 검증하면 원래 사용자·프로젝트가 그대로 나온다", () => {
    process.env.SITE_SESSION_SECRET = "test-session-secret";
    const token = signSiteSession({ siteUserId: "su-1", projectId: "proj-1" });

    expect(verifySiteSession(token)).toEqual({ siteUserId: "su-1", projectId: "proj-1" });
  });

  it("한 글자라도 위조된 토큰은 거부한다", () => {
    process.env.SITE_SESSION_SECRET = "test-session-secret";
    const token = signSiteSession({ siteUserId: "su-1", projectId: "proj-1" });
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");

    expect(verifySiteSession(tampered)).toBeNull();
  });

  it("다른 비밀값으로 서명된 토큰은 거부한다 (열쇠를 바꾸면 옛 세션이 전부 무효화된다)", () => {
    process.env.SITE_SESSION_SECRET = "secret-a";
    const token = signSiteSession({ siteUserId: "su-1", projectId: "proj-1" });

    process.env.SITE_SESSION_SECRET = "secret-b";
    expect(verifySiteSession(token)).toBeNull();
  });

  it("만료된 토큰은 거부한다", () => {
    process.env.SITE_SESSION_SECRET = "test-session-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = signSiteSession({ siteUserId: "su-1", projectId: "proj-1" });

    vi.setSystemTime(new Date("2026-03-01T00:00:00Z")); // 30일 훨씬 지남
    expect(verifySiteSession(token)).toBeNull();
  });

  it("형식이 아예 다른 문자열은 예외 없이 null을 돌려준다", () => {
    process.env.SITE_SESSION_SECRET = "test-session-secret";
    expect(verifySiteSession("전혀-토큰이-아닌-값")).toBeNull();
  });

  it("비밀값이 없으면 서명 자체를 거부한다 — 조용히 안전하지 않은 토큰을 내면 안 된다", () => {
    delete process.env.SITE_SESSION_SECRET;
    expect(() => signSiteSession({ siteUserId: "su-1", projectId: "proj-1" })).toThrow();
  });
});
