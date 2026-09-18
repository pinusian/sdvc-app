import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSiteUser } from "@/lib/site-accounts/access";
import { setSiteUserApiKey, hasSiteUserApiKey } from "@/lib/site-accounts/store";

/**
 * [P11-4] GET/POST /api/site/[slug]/settings/api-key — 사용자 본인의
 * Anthropic API 키 등록. **쓰기 전용**이다(비밀번호와 같은 취급) — 한 번
 * 저장하면 이 서버도 다시 원문을 화면에 보여주지 않는다. GET은 등록
 * 여부만 알려준다.
 */

const KEY_PREFIX = "sk-ant-";
const MIN_KEY_LENGTH = 20;

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const admin = createAdminClient();

  const auth = await requireSiteUser(admin, slug, request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const hasApiKey = await hasSiteUserApiKey(admin, auth.siteUserId);
  return NextResponse.json({ hasApiKey });
}

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

  let body: { apiKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey.startsWith(KEY_PREFIX) || apiKey.length < MIN_KEY_LENGTH) {
    return NextResponse.json(
      { error: `Anthropic API 키 형식이 아닌 것 같습니다. "${KEY_PREFIX}"로 시작하는 키를 그대로 붙여넣어 주세요.` },
      { status: 400 },
    );
  }

  await setSiteUserApiKey(admin, { siteUserId: auth.siteUserId, apiKey });
  return NextResponse.json({ ok: true });
}
