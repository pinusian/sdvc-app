import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { getProjectById } from "@/lib/projects/store";
import { getOwnedSiteUser, unsuspendSiteUser } from "@/lib/site-accounts/store";

/** [P11-6] POST /api/projects/[id]/site-users/[siteUserId]/unsuspend — 방문자 정지 해제. */
export async function POST(
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

  await unsuspendSiteUser(admin, siteUser.id);
  return NextResponse.json({ suspended: false });
}
