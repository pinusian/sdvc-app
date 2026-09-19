import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { getProjectById } from "@/lib/projects/store";
import { getOwnedSiteUser, suspendSiteUser } from "@/lib/site-accounts/store";

/**
 * [P11-6] POST /api/projects/[id]/site-users/[siteUserId]/suspend — 방문자 정지.
 *
 * 두 겹의 소유권 검사: 프로젝트가 이 개발자 것인지(`getProjectById`), 그리고
 * 이 방문자가 **그 프로젝트** 소속인지(`getOwnedSiteUser`). 후자가 없으면
 * 다른 프로젝트의 방문자 id를 알아내 정지시킬 수 있다.
 */
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

  let body: { reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "정지 사유를 입력해주세요." }, { status: 400 });
  }

  await suspendSiteUser(admin, { siteUserId: siteUser.id, reason });
  return NextResponse.json({ suspended: true });
}
