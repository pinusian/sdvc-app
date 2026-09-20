import { describe, expect, it, vi } from "vitest";
import { createProviderCredentialLoader } from "@/lib/openai/provider-credential-loader";
import {
  encryptProviderCredential,
  type ProviderCredentialEnvelope,
} from "@/lib/openai/provider-credentials";

const OWNER_ID = "learner-1";
const SECRET = "sk-proj-loader-secret-7890";
const KEY = { keyVersion: "v1", secret: Buffer.alloc(32, 13) };

function loaderDependencies(envelope: ProviderCredentialEnvelope | null) {
  return {
    loadEnvelope: vi.fn().mockResolvedValue(envelope),
    loadKey: vi.fn().mockReturnValue(KEY),
  };
}

describe("[T026] Codex 중계 자격 로더", () => {
  it("암호문이 없으면 서버 키를 읽지 않고 미등록 상태를 반환한다", async () => {
    const dependencies = loaderDependencies(null);
    const loadApiKey = createProviderCredentialLoader({} as never, dependencies);

    await expect(loadApiKey(OWNER_ID)).resolves.toBeNull();
    expect(dependencies.loadEnvelope).toHaveBeenCalledWith(OWNER_ID);
    expect(dependencies.loadKey).not.toHaveBeenCalled();
  });

  it("저장 암호문을 호출 직전에만 복호화한다", async () => {
    const envelope = encryptProviderCredential(SECRET, KEY);
    const dependencies = loaderDependencies(envelope);
    const loadApiKey = createProviderCredentialLoader({} as never, dependencies);

    await expect(loadApiKey(OWNER_ID)).resolves.toBe(SECRET);
    expect(JSON.stringify(envelope)).not.toContain(SECRET);
  });

  it("키 버전이 다르면 원문이나 암호문을 노출하지 않는 오류로 거부한다", async () => {
    const envelope = encryptProviderCredential(SECRET, { ...KEY, keyVersion: "old" });
    const dependencies = loaderDependencies(envelope);
    const loadApiKey = createProviderCredentialLoader({} as never, dependencies);

    const error = await loadApiKey(OWNER_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/버전/);
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect((error as Error).message).not.toContain(envelope.ciphertext);
  });

  it("삭제된 암호문은 같은 로더의 다음 호출부터 즉시 미등록으로 처리한다", async () => {
    const envelope = encryptProviderCredential(SECRET, KEY);
    let stored: ProviderCredentialEnvelope | null = envelope;
    const dependencies = {
      loadEnvelope: vi.fn(async () => stored),
      loadKey: vi.fn(() => KEY),
    };
    const loadApiKey = createProviderCredentialLoader({} as never, dependencies);

    await expect(loadApiKey(OWNER_ID)).resolves.toBe(SECRET);
    stored = null;
    await expect(loadApiKey(OWNER_ID)).resolves.toBeNull();
  });
});
