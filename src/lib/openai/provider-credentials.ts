import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface ProviderCredentialEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  lastFour: string;
}

export interface ProviderCredentialKey {
  keyVersion: string;
  secret: Uint8Array;
}

export interface ProviderCredentialStatus {
  configured: boolean;
  maskedKey: string | null;
  keyVersion: string | null;
  updatedAt: string | null;
}

export interface SaveProviderCredentialInput {
  ownerId: string;
  provider: "openai";
  envelope: ProviderCredentialEnvelope;
  updatedAt: string;
}

export interface ProviderCredentialMutationDependencies {
  encrypt(
    apiKey: string,
  ): ProviderCredentialEnvelope | Promise<ProviderCredentialEnvelope>;
  save(input: SaveProviderCredentialInput): Promise<void>;
  remove(input: { ownerId: string; provider: "openai" }): Promise<boolean>;
  cancelActiveRuns(ownerId: string): Promise<number>;
  audit(input: {
    ownerId: string;
    action: "registered" | "replaced" | "deleted";
    occurredAt: string;
    keyVersion: string | null;
    maskedKey: string | null;
  }): Promise<void>;
}

export function encryptProviderCredential(
  apiKey: string,
  key: ProviderCredentialKey,
): ProviderCredentialEnvelope {
  const value = apiKey.trim();
  if (!value) throw new Error("OpenAI API 키를 입력해 주세요.");
  if (key.secret.byteLength !== 32) {
    throw new Error("공급자 자격 암호화 키는 32바이트여야 합니다.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.secret, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: key.keyVersion,
    lastFour: value.slice(-4),
  };
}

export function decryptProviderCredential(
  envelope: ProviderCredentialEnvelope,
  key: ProviderCredentialKey,
): string {
  if (envelope.keyVersion !== key.keyVersion) {
    throw new Error("공급자 자격 암호화 키 버전이 일치하지 않습니다.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key.secret,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskProviderApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) throw new Error("OpenAI API 키를 입력해 주세요.");
  return `••••${value.slice(-4)}`;
}

export async function registerProviderCredential(
  input: {
    ownerId: string;
    apiKey: string;
    replacing: boolean;
    now: string;
  },
  dependencies: ProviderCredentialMutationDependencies,
): Promise<ProviderCredentialStatus> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("OpenAI API 키를 입력해 주세요.");
  const envelope = await dependencies.encrypt(apiKey);
  const maskedKey = maskProviderApiKey(apiKey);
  await dependencies.save({
    ownerId: input.ownerId,
    provider: "openai",
    envelope,
    updatedAt: input.now,
  });
  await dependencies.audit({
    ownerId: input.ownerId,
    action: input.replacing ? "replaced" : "registered",
    occurredAt: input.now,
    keyVersion: envelope.keyVersion,
    maskedKey,
  });
  return { configured: true, maskedKey, keyVersion: envelope.keyVersion, updatedAt: input.now };
}

export async function deleteProviderCredential(
  input: { ownerId: string; now: string },
  dependencies: ProviderCredentialMutationDependencies,
): Promise<ProviderCredentialStatus & { cancelledRunCount: number }> {
  await dependencies.remove({ ownerId: input.ownerId, provider: "openai" });
  const cancelledRunCount = await dependencies.cancelActiveRuns(input.ownerId);
  await dependencies.audit({
    ownerId: input.ownerId,
    action: "deleted",
    occurredAt: input.now,
    keyVersion: null,
    maskedKey: null,
  });
  return {
    configured: false,
    maskedKey: null,
    keyVersion: null,
    updatedAt: null,
    cancelledRunCount,
  };
}

export function redactProviderCredentialSecrets(
  value: unknown,
  secrets: readonly string[],
): unknown {
  const activeSecrets = secrets.filter(Boolean);
  const clean = (input: unknown): unknown => {
    if (typeof input === "string") {
      return activeSecrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), input);
    }
    if (Array.isArray(input)) return input.map(clean);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, clean(item)]));
    }
    return input;
  };
  return clean(value);
}

export function redactProviderCredentialText(
  value: string,
  secrets: readonly string[],
): string {
  return redactProviderCredentialSecrets(value, secrets) as string;
}
