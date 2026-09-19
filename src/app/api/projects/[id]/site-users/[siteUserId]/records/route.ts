import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { getProjectById } from "@/lib/projects/store";
import { getOwnedSiteUser, listSiteRecordsByUser } from "@/lib/site-accounts/store";

/**
 * [P11-6] GET /api/projects/[id]/site-users/[siteUserId]/records — 개발자가
 * 특정 방문자의 기록을 열람한다. `getOwnedSiteUser`로 그 방문자가 이
 * 프로젝트 소속인지 먼저 확인하지 않으면, 다른 프로젝트의 방문자 id를
 * 알아내 기록을 훔쳐볼 수 있다.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; siteUserId: string }> },
) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { user } = access;

  const { id, siteUserId } = await context.params;
  const admin = createAdminClient();

  const project = await getProjectById(admin, id, user.id);
  if (!project) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  const siteUser = await getOwnedSiteUser(admin, { projectId: project.id, siteUserId });
  if (!siteUser) {
    return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  }

  const records = await listSiteRecordsByUser(admin, { projectId: project.id, siteUserId: siteUser.id });
  return NextResponse.json({ records });
}
