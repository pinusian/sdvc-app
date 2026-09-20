import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptProviderCredential,
  deleteProviderCredential,
  encryptProviderCredential,
  maskProviderApiKey,
  redactProviderCredentialSecrets,
  registerProviderCredential,
  type ProviderCredentialEnvelope,
  type ProviderCredentialMutationDependencies,
} from "@/lib/openai/provider-credentials";

const SECRET = "sk-proj-user-secret-1234567890";
const NOW = "2026-09-20T06:00:00.000Z";
const ENVELOPE: ProviderCredentialEnvelope = {
  ciphertext: "ciphertext-value",
  iv: "unique-iv",
  authTag: "authentication-tag",
  keyVersion: "v1",
  lastFour: "7890",
};

function dependencies(): ProviderCredentialMutationDependencies {
  return {
    encrypt: vi.fn().mockReturnValue(ENVELOPE),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(true),
    cancelActiveRuns: vi.fn().mockResolvedValue(2),
    audit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("[T023] 사용자 OpenAI 키 암호화·마스킹 계약", () => {
  it("인증 암호화한 값은 복호화할 수 있지만 저장값에는 원문이 없다", () => {
    const key = { keyVersion: "v1", secret: Buffer.alloc(32, 7) };

    const encrypted = encryptProviderCredential(SECRET, key);

    expect(encrypted.keyVersion).toBe("v1");
    expect(encrypted.lastFour).toBe("7890");
    expect(JSON.stringify(encrypted)).not.toContain(SECRET);
    expect(decryptProviderCredential(encrypted, key)).toBe(SECRET);
  });

  it("같은 키도 매번 다른 nonce를 사용해 다른 암호문을 만든다", () => {
    const key = { keyVersion: "v1", secret: Buffer.alloc(32, 9) };

    const first = encryptProviderCredential(SECRET, key);
    const second = encryptProviderCredential(SECRET, key);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("조회용 마스킹은 마지막 네 글자 외 원문을 노출하지 않는다", () => {
    const masked = maskProviderApiKey(SECRET);

    expect(masked).toBe("••••7890");
    expect(masked).not.toContain("user-secret");
  });
});

describe("[T023] 사용자 OpenAI 키 등록·교체·삭제 계약", () => {
  beforeEach(() => vi.clearAllMocks());

  it("등록 시 원문은 암호화 경계에만 전달하고 저장·응답·감사에는 남기지 않는다", async () => {
    const deps = dependencies();

    const status = await registerProviderCredential(
      { ownerId: "learner-1", apiKey: SECRET, replacing: false, now: NOW },
      deps,
    );

    expect(deps.encrypt).toHaveBeenCalledWith(SECRET);
    expect(deps.save).toHaveBeenCalledWith({
      ownerId: "learner-1",
      provider: "openai",
      envelope: ENVELOPE,
      updatedAt: NOW,
    });
    expect(status).toEqual({
      configured: true,
      maskedKey: "••••7890",
      keyVersion: "v1",
      updatedAt: NOW,
    });
    expect(JSON.stringify([status, vi.mocked(deps.save).mock.calls, vi.mocked(deps.audit).mock.calls]))
      .not.toContain(SECRET);
  });

  it("교체는 같은 사용자·공급자 자격을 새 암호문으로 덮고 교체 감사를 남긴다", async () => {
    const deps = dependencies();
    const replacement = { ...ENVELOPE, ciphertext: "replacement-ciphertext", lastFour: "4321" };
    vi.mocked(deps.encrypt).mockReturnValue(replacement);

    await registerProviderCredential(
      { ownerId: "learner-1", apiKey: "sk-proj-replacement-4321", replacing: true, now: NOW },
      deps,
    );

    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "learner-1", provider: "openai", envelope: replacement }),
    );
    expect(deps.audit).toHaveBeenCalledWith({
      ownerId: "learner-1",
      action: "replaced",
      occurredAt: NOW,
      keyVersion: "v1",
      maskedKey: "••••4321",
    });
  });

  it("삭제는 저장 자격을 제거하고 활성 실행을 취소해 이후 상태를 미등록으로 만든다", async () => {
    const deps = dependencies();

    const status = await deleteProviderCredential({ ownerId: "learner-1", now: NOW }, deps);

    expect(deps.remove).toHaveBeenCalledWith({ ownerId: "learner-1", provider: "openai" });
    expect(deps.cancelActiveRuns).toHaveBeenCalledWith("learner-1");
    expect(status).toEqual({
      configured: false,
      maskedKey: null,
      keyVersion: null,
      updatedAt: null,
      cancelledRunCount: 2,
    });
    expect(deps.audit).toHaveBeenCalledWith({
      ownerId: "learner-1",
      action: "deleted",
      occurredAt: NOW,
      keyVersion: null,
      maskedKey: null,
    });
  });

  it("공백 키는 저장·감사 전에 거부한다", async () => {
    const deps = dependencies();

    await expect(
      registerProviderCredential(
        { ownerId: "learner-1", apiKey: "   ", replacing: false, now: NOW },
        deps,
      ),
    ).rejects.toThrow(/키/);
    expect(deps.encrypt).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });
});

describe("[T023] 사용자 OpenAI 키 로그 비노출 계약", () => {
  it("중첩 로그와 오류 문자열에 섞인 원문 키를 모두 정제한다", () => {
    const sanitized = redactProviderCredentialSecrets(
      {
        message: `provider rejected ${SECRET}`,
        nested: [{ authorization: `Bearer ${SECRET}` }],
        safe: "rate_limit_exceeded",
      },
      [SECRET],
    );

    expect(JSON.stringify(sanitized)).not.toContain(SECRET);
    expect(sanitized).toMatchObject({ safe: "rate_limit_exceeded" });
  });
});
