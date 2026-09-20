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
  _apiKey: string,
  _key: ProviderCredentialKey,
): ProviderCredentialEnvelope {
  void _apiKey;
  void _key;
  throw new Error("T023 provider credential encryption is not implemented");
}

export function decryptProviderCredential(
  _envelope: ProviderCredentialEnvelope,
  _key: ProviderCredentialKey,
): string {
  void _envelope;
  void _key;
  throw new Error("T023 provider credential decryption is not implemented");
}

export function maskProviderApiKey(_apiKey: string): string {
  void _apiKey;
  throw new Error("T023 provider credential masking is not implemented");
}

export async function registerProviderCredential(
  _input: {
    ownerId: string;
    apiKey: string;
    replacing: boolean;
    now: string;
  },
  _dependencies: ProviderCredentialMutationDependencies,
): Promise<ProviderCredentialStatus> {
  void _input;
  void _dependencies;
  throw new Error("T023 provider credential registration is not implemented");
}

export async function deleteProviderCredential(
  _input: { ownerId: string; now: string },
  _dependencies: ProviderCredentialMutationDependencies,
): Promise<ProviderCredentialStatus & { cancelledRunCount: number }> {
  void _input;
  void _dependencies;
  throw new Error("T023 provider credential deletion is not implemented");
}

export function redactProviderCredentialSecrets(
  _value: unknown,
  _secrets: readonly string[],
): unknown {
  void _value;
  void _secrets;
  throw new Error("T023 provider credential log redaction is not implemented");
}
