import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProviderCredentialEnvelope,
  ProviderCredentialStatus,
  SaveProviderCredentialInput,
} from "@/lib/openai/provider-credentials";

function assertNoError(error: { message?: string } | null) {
  if (error) throw new Error(error.message ?? "OpenAI 자격 저장소 오류");
}

export async function saveProviderCredential(
  client: SupabaseClient,
  input: SaveProviderCredentialInput,
): Promise<void> {
  const { error } = await client.from("provider_credentials").upsert(
    {
      owner_id: input.ownerId,
      provider: input.provider,
      ciphertext: input.envelope.ciphertext,
      iv: input.envelope.iv,
      auth_tag: input.envelope.authTag,
      key_version: input.envelope.keyVersion,
      last_four: input.envelope.lastFour,
      updated_at: input.updatedAt,
    },
    { onConflict: "owner_id,provider" },
  );
  assertNoError(error);
}

export async function getProviderCredentialStatus(
  client: SupabaseClient,
  ownerId: string,
): Promise<ProviderCredentialStatus> {
  const { data, error } = await client
    .from("provider_credentials")
    .select("last_four, key_version, updated_at")
    .eq("owner_id", ownerId)
    .eq("provider", "openai")
    .maybeSingle();
  assertNoError(error);
  if (!data) return { configured: false, maskedKey: null, keyVersion: null, updatedAt: null };
  const row = data as { last_four: string; key_version: string; updated_at: string };
  return {
    configured: true,
    maskedKey: `••••${row.last_four}`,
    keyVersion: row.key_version,
    updatedAt: row.updated_at,
  };
}

export async function loadProviderCredentialEnvelope(
  client: SupabaseClient,
  ownerId: string,
): Promise<ProviderCredentialEnvelope | null> {
  const { data, error } = await client
    .from("provider_credentials")
    .select("ciphertext, iv, auth_tag, key_version, last_four")
    .eq("owner_id", ownerId)
    .eq("provider", "openai")
    .maybeSingle();
  assertNoError(error);
  if (!data) return null;
  const row = data as Record<string, string>;
  return {
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
    lastFour: row.last_four,
  };
}

export async function removeProviderCredential(
  client: SupabaseClient,
  ownerId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("provider_credentials")
    .delete()
    .eq("owner_id", ownerId)
    .eq("provider", "openai")
    .select("owner_id")
    .maybeSingle();
  assertNoError(error);
  return Boolean(data);
}
