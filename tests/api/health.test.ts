import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("[P2-3] GET /api/health", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.SITE_API_KEY_ENCRYPTION_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("환경변수가 없으면 모두 false/null로 보고한다 (실제 키 값은 노출하지 않음)", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({
      supabaseUrlConfigured: false,
      supabaseKeyConfigured: false,
      supabaseReachable: null,
      anthropicKeyConfigured: false,
      // [BL-008] 서버관리자 자동 승격 설정 여부 — 값이 아니라 있고 없음만
      adminEmailConfigured: false,
      // [P11-1] 사용자(방문자) API 키 암호화 열쇠 설정 여부
      siteApiKeyEncryptionSecretConfigured: false,
      // [P8-12] 로컬에서는 배포 커밋이 없다
      commit: null,
    });
  });

  it("[P11-1] SITE_API_KEY_ENCRYPTION_SECRET이 있으면 true를 보고한다 (값은 노출 안 함)", async () => {
    process.env.SITE_API_KEY_ENCRYPTION_SECRET = "some-random-secret-value";

    const { GET } = await import("@/app/api/health/route");
    const body = await (await GET()).json();

    expect(body.siteApiKeyEncryptionSecretConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("some-random-secret-value");
  });

  it("[P8-12] 배포된 커밋을 짧게 알려준다 — '고쳤는데 반영됐나'를 매번 추측하지 않기 위해", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "6f41e9b1234567890abcdef1234567890abcdef1";

    const { GET } = await import("@/app/api/health/route");
    const body = await (await GET()).json();

    expect(body.commit).toBe("6f41e9b");
  });

  it("Supabase 환경변수가 있으면 연결을 시도하고 결과를 boolean으로만 반환한다", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true } as Response),
    );

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();

    expect(body.supabaseUrlConfigured).toBe(true);
    expect(body.supabaseKeyConfigured).toBe(true);
    expect(body.supabaseReachable).toBe(true);
    expect(JSON.stringify(body)).not.toContain("test-key");

    vi.unstubAllGlobals();
  });
});
