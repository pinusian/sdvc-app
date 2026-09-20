import type { ProviderCredentialKey } from "@/lib/openai/provider-credentials";

export function loadProviderCredentialKey(): ProviderCredentialKey {
  const keyVersion = process.env.OPENAI_CREDENTIAL_ENCRYPTION_KEY_VERSION?.trim();
  const encoded = process.env.OPENAI_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!keyVersion || !encoded) {
    throw new Error("OpenAI 자격 암호화 설정이 없습니다.");
  }
  const secret = Buffer.from(encoded, "base64");
  if (secret.byteLength !== 32) {
    throw new Error("OpenAI 자격 암호화 키는 base64 32바이트여야 합니다.");
  }
  return { keyVersion, secret };
}
