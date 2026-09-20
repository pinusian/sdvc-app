import { describe, expect, it, afterEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  encryptApiKey,
  decryptApiKey,
  generateTempPassword,
} from "@/lib/site-accounts/crypto";

/**
 * [P11-1] 비밀번호는 해시(되돌릴 수 없음), API 키는 암호화(되돌릴 수 있어야
 * 실제로 Anthropic을 부를 때 다시 쓸 수 있다) — 성격이 달라 함수를 나눈다.
 */

describe("[P11-1] hashPassword / verifyPassword", () => {
  it("같은 비밀번호도 해시할 때마다 값이 다르다 (매번 다른 salt)", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a).not.toBe(b);
  });

  it("맞는 비밀번호는 통과한다", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("틀린 비밀번호는 거부한다", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("해시에는 원문이 그대로 들어있지 않다", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toContain("hunter2");
  });
});

describe("[P11-4] encryptApiKey / decryptApiKey", () => {
  const originalEnv = process.env.SITE_API_KEY_ENCRYPTION_SECRET;
  afterEach(() => {
    process.env.SITE_API_KEY_ENCRYPTION_SECRET = originalEnv;
  });

  it("암호화한 값을 복호화하면 원래 키가 그대로 나온다", () => {
    process.env.SITE_API_KEY_ENCRYPTION_SECRET = "test-secret-32-bytes-minimum!!!!";
    const key = "sk-ant-api03-실제키처럼생긴값";
    const encrypted = encryptApiKey(key);
    expect(decryptApiKey(encrypted)).toBe(key);
  });

  it("저장되는 값에는 원문 키가 그대로 보이지 않는다", () => {
    process.env.SITE_API_KEY_ENCRYPTION_SECRET = "test-secret-32-bytes-minimum!!!!";
    const key = "sk-ant-api03-superSecretValue";
    expect(encryptApiKey(key)).not.toContain(key);
  });

  it("같은 키도 암호화할 때마다 저장값이 다르다 (매번 다른 IV)", () => {
    process.env.SITE_API_KEY_ENCRYPTION_SECRET = "test-secret-32-bytes-minimum!!!!";
    const a = encryptApiKey("same-key");
    const b = encryptApiKey("same-key");
    expect(a).not.toBe(b);
  });

  it("암호화 비밀값이 없으면 던진다 — 조용히 평문으로 새면 안 된다", () => {
    delete process.env.SITE_API_KEY_ENCRYPTION_SECRET;
    expect(() => encryptApiKey("some-key")).toThrow();
  });
});

/**
 * [BL-031] 개발자가 방문자 대신 비밀번호를 재설정할 때 쓸 임시 비밀번호.
 * 개발자가 직접 값을 지어내지 않는다(약한 값을 고를 수 있다) — 서버가
 * 무작위로 만들어 한 번만 보여준다.
 */
describe("[BL-031] generateTempPassword", () => {
  it("최소 10자 이상이다", () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(10);
  });

  it("부를 때마다 다른 값을 만든다", () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });

  it("헷갈리는 문자(0/O, 1/l/I)는 쓰지 않는다 — 개발자가 사람에게 구두로 전달해야 한다", () => {
    const pw = generateTempPassword();
    expect(pw).not.toMatch(/[0OIl1]/);
  });
});
