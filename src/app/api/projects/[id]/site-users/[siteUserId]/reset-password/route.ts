import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/projects/store";
import { getOwnedSiteUser, setSiteUserPasswordHash } from "@/lib/site-accounts/store";
import { generateTempPassword, hashPassword } from "@/lib/site-accounts/crypto";

/**
 * [BL-031] POST /api/projects/[id]/site-users/[siteUserId]/reset-password —
 * 방문자 계정은 이메일 발송 수단이 없어([BL-030]은 Supabase Auth 계정용)
 * 본인이 직접 "비밀번호 찾기"를 할 수 없다. 개발자가 대신 새 임시
 * 비밀번호를 만들어 본인에게 직접(이메일·문자 등 이 서비스 밖의 방법으로)
 * 전달한다.
 *
 * 개발자가 값을 직접 짓지 않는다(약한 값을 고를 위험) — 서버가 무작위로
 * 만들어 **이 응답에만** 평문으로 담고, 저장은 해시만 한다. 소유권 검사는
 * 정지·기록 열람과 완전히 같다(getProjectById + getOwnedSiteUser).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; siteUserId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

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

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await setSiteUserPasswordHash(admin, { siteUserId: siteUser.id, passwordHash });

  return NextResponse.json({ tempPassword });
}
