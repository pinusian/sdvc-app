import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSiteUser } from "@/lib/site-accounts/access";
import { getSiteUserApiKey } from "@/lib/site-accounts/store";
import { callSiteUserAI, SiteAIError } from "@/lib/site-accounts/ai-proxy";

/**
 * [P11-4] POST /api/site/[slug]/ai/summarize — 로그인한 사용자 본인의
 * (암호화 저장된) 키로 서버가 대신 Claude를 부른다. 과금은 그 키의 주인
 * (사용자)에게 나간다 — 이 서버나 개발자에게 나가지 않는다.
 */

const MAX_PROMPT_LENGTH = 20_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const admin = createAdminClient();

  const auth = await requireSiteUser(admin, slug, request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { prompt?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `내용이 너무 깁니다(최대 ${MAX_PROMPT_LENGTH.toLocaleString()}자).` },
      { status: 400 },
    );
  }

  const apiKey = await getSiteUserApiKey(admin, auth.siteUserId);
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI 기능을 쓰려면 먼저 설정에서 본인의 Anthropic API 키를 등록해주세요." },
      { status: 400 },
    );
  }

  try {
    const result = await callSiteUserAI({ apiKey, prompt });
    return NextResponse.json({ summary: result.text });
  } catch (error) {
    if (error instanceof SiteAIError) {
      return NextResponse.json(
        { error: `AI 호출에 실패했습니다. (상태 ${error.status}) 등록하신 API 키가 맞는지 확인해주세요.` },
        { status: 502 },
      );
    }
    throw error;
  }
}
