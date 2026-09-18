import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSiteUser } from "@/lib/site-accounts/access";
import { listSiteRecordsByUser, createSiteRecord } from "@/lib/site-accounts/store";

/**
 * [P11-3] GET/POST /api/site/[slug]/records — 본인 기록만 읽고 쓴다.
 *
 * project_id·site_user_id는 **요청 본문에서 절대 받지 않는다** — 관문
 * (`requireSiteUser`)이 세션으로 확인한 값만 쓴다. 클라이언트가 보낸 id를
 * 믿으면 남의 프로젝트·남의 계정 이름으로 기록을 만들 수 있다.
 */
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

  const records = await listSiteRecordsByUser(admin, {
    projectId: auth.project.id,
    siteUserId: auth.siteUserId,
  });

  return NextResponse.json({ records });
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

  let body: { title?: unknown; author?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
  }

  const record = await createSiteRecord(admin, {
    projectId: auth.project.id,
    siteUserId: auth.siteUserId,
    title,
    author: typeof body.author === "string" ? body.author : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
  });

  return NextResponse.json({ record });
}
