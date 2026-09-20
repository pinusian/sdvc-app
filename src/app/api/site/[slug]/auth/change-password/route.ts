import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSiteUser } from "@/lib/site-accounts/access";
import { getSiteUserPasswordHash, setSiteUserPasswordHash } from "@/lib/site-accounts/store";
import { verifyPassword, hashPassword } from "@/lib/site-accounts/crypto";

const MIN_PASSWORD_LENGTH = 8;

/**
 * [BL-032] POST /api/site/[slug]/auth/change-password — 방문자 본인이
 * 로그인한 뒤 스스로 비밀번호를 바꾼다.
 *
 * [BL-031]에서 개발자가 대신 재설정한 임시 비밀번호가 사실상 영구
 * 비밀번호가 되는 문제를 이걸로 닫는다. 세션이 살아있다는 것만으로
 * 바꾸게 하지 않고 **현재 비밀번호**를 먼저 확인한다 — 세션이 탈취돼도
 * 비밀번호까지 바뀌는 피해로는 이어지지 않게 한다.
 */
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

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  const currentHash = await getSiteUserPasswordHash(admin, auth.siteUserId);
  const currentOk = currentHash ? await verifyPassword(currentPassword, currentHash) : false;
  if (!currentOk) {
    return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await setSiteUserPasswordHash(admin, { siteUserId: auth.siteUserId, passwordHash });

  return NextResponse.json({ ok: true });
}
