import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/projects/store";
import { listSiteUsersByProject } from "@/lib/site-accounts/store";

/**
 * [P11-6] GET /api/projects/[id]/site-users — 개발자(교수) 관리 화면의 방문자 목록.
 *
 * 소유권 검사는 [P5-3] 공개범위·[P7-6b] 되돌리기와 같은 방식
 * (`getProjectById(admin, id, user.id)`) — 남의 프로젝트 방문자 목록을 볼 수
 * 있으면 안 된다. 비밀번호 해시·API 키 암호문은 `site-accounts/store`의
 * `SiteUser` 타입 자체에 없어 실수로 새어나갈 길이 없다.
 */
export async function GET(
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

  const users = await listSiteUsersByProject(admin, project.id);
  return NextResponse.json({ users });
}
