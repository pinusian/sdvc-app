import { NextResponse } from "next/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { cancelActiveWorkForUser } from "@/lib/execution/active-work";
import {
  deleteProviderCredential,
  encryptProviderCredential,
  redactProviderCredentialText,
  registerProviderCredential,
} from "@/lib/openai/provider-credentials";
import { loadProviderCredentialKey } from "@/lib/openai/provider-credential-key";
import {
  getProviderCredentialStatus,
  removeProviderCredential,
  saveProviderCredential,
} from "@/lib/openai/provider-credential-store";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const status = await getProviderCredentialStatus(createAdminClient(), access.user.id);
  return NextResponse.json(status);
}

export async function PUT(request: Request) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  let apiKey: unknown;
  try {
    ({ apiKey } = (await request.json()) as { apiKey?: unknown });
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return NextResponse.json({ error: "OpenAI API 키를 입력해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const current = await getProviderCredentialStatus(admin, access.user.id);
  try {
    const key = loadProviderCredentialKey();
    const status = await registerProviderCredential(
      { ownerId: access.user.id, apiKey, replacing: current.configured, now: new Date().toISOString() },
      {
        encrypt: (value) => encryptProviderCredential(value, key),
        save: (input) => saveProviderCredential(admin, input),
        remove: ({ ownerId }) => removeProviderCredential(admin, ownerId),
        cancelActiveRuns: async (ownerId) => cancelActiveWorkForUser(ownerId),
        audit: async () => undefined,
      },
    );
    return NextResponse.json(status);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "OpenAI API 키를 저장하지 못했습니다.";
    const safeMessage = redactProviderCredentialText(rawMessage, [apiKey]);
    return NextResponse.json(
      { error: safeMessage },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const admin = createAdminClient();
  const status = await deleteProviderCredential(
    { ownerId: access.user.id, now: new Date().toISOString() },
    {
      encrypt: () => {
        throw new Error("삭제 경로에서는 암호화를 호출하지 않습니다.");
      },
      save: async () => undefined,
      remove: ({ ownerId }) => removeProviderCredential(admin, ownerId),
      cancelActiveRuns: async (ownerId) => cancelActiveWorkForUser(ownerId),
      audit: async () => undefined,
    },
  );
  return NextResponse.json(status);
}
