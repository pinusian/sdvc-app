import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProviderCredentialKey } from "@/lib/openai/provider-credential-key";
import { loadProviderCredentialEnvelope } from "@/lib/openai/provider-credential-store";
import {
  decryptProviderCredential,
  type ProviderCredentialEnvelope,
  type ProviderCredentialKey,
} from "@/lib/openai/provider-credentials";

interface ProviderCredentialLoaderDependencies {
  loadEnvelope(ownerId: string): Promise<ProviderCredentialEnvelope | null>;
  loadKey(): ProviderCredentialKey;
}

/**
 * Codex 중계가 호출 직전에만 원문 키를 얻는 서버 전용 경계다.
 * 영속 실행 입력에는 owner id만 두고, 암호문이 삭제되면 다음 호출부터 null을 반환한다.
 */
export const createProviderCredentialLoader = (
  client: SupabaseClient,
  dependencies: ProviderCredentialLoaderDependencies = {
    loadEnvelope: (ownerId) => loadProviderCredentialEnvelope(client, ownerId),
    loadKey: loadProviderCredentialKey,
  },
): ((ownerId: string) => Promise<string | null>) => {
  return async (ownerId: string) => {
    const envelope = await dependencies.loadEnvelope(ownerId);
    if (!envelope) return null;

    return decryptProviderCredential(envelope, dependencies.loadKey());
  };
};
