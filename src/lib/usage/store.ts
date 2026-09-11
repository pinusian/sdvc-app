import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd } from "@/lib/usage/pricing";

/**
 * [P6-2] 사용량 기록과 합계.
 *
 * `usage_logs`는 RLS 정책이 없다(과금 근거라 브라우저가 건드리면 안 된다) —
 * 여기 오는 클라이언트는 secret key를 쓰는 서버측 관리자 클라이언트여야 한다.
 */

export interface UsageInput {
  userId: string;
  conversationId?: string | null;
  projectId?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function assertNoError(error: unknown, what: string): void {
  if (!error) return;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  throw new Error(`${what} 실패: ${message}`);
}

export async function recordUsage(
  admin: SupabaseClient,
  { userId, conversationId = null, projectId = null, model, inputTokens, outputTokens }: UsageInput,
): Promise<void> {
  const { error } = await admin
    .from("usage_logs")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      project_id: projectId,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      // 그때의 단가로 계산해 저장한다 (나중에 단가가 바뀌어도 과거는 그대로).
      cost_usd: costUsd(model, inputTokens, outputTokens),
    })
    .select("id")
    .single();

  assertNoError(error, "사용량 기록");
}

/** 이번 달(UTC 기준) 쓴 토큰 합계 — 입력+출력. 한도 판정([P6-3])의 근거. */
export async function monthlyTokenUsage(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  ).toISOString();

  const { data, error } = await admin
    .from("usage_logs")
    .select("input_tokens, output_tokens")
    .eq("user_id", userId)
    .gte("created_at", monthStart);

  assertNoError(error, "사용량 조회");

  return ((data ?? []) as { input_tokens: number; output_tokens: number }[]).reduce(
    (sum, row) => sum + row.input_tokens + row.output_tokens,
    0,
  );
}
