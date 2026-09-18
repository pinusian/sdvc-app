import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getProjectById, setProjectSiteLoginEnabled } from "@/lib/projects/store";

/**
 * [P11-7] PATCH /api/projects/[id]/site-login — 방문자 로그인 켜기/끄기.
 * 끄면 `gateSiteProject`가 403으로 막는다([P11-2]) — 이미 가입한 방문자
 * 계정·기록은 지워지지 않고, 다시 켜면 그대로 돌아온다.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await context.params;
  const admin = createAdminClient();

  const project = await getProjectById(admin, id, user.id);
  if (!project) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  let enabled: unknown;
  try {
    ({ enabled } = (await request.json()) as { enabled?: unknown });
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "켜짐·꺼짐 값이어야 합니다." }, { status: 400 });
  }

  await setProjectSiteLoginEnabled(admin, project.id, user.id, enabled);
  return NextResponse.json({ enabled });
}
