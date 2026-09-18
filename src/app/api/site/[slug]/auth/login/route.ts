import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { gateSiteProject } from "@/lib/site-accounts/access";
import { findSiteUserByEmail } from "@/lib/site-accounts/store";
import { verifyPassword } from "@/lib/site-accounts/crypto";
import { signSiteSession } from "@/lib/site-accounts/session";
import { SITE_SESSION_COOKIE, siteSessionCookieOptions } from "@/lib/site-accounts/cookie";

const WRONG_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다.";

/**
 * [P11-2] POST /api/site/[slug]/auth/login — 사용자(방문자) 로그인.
 *
 * 계정이 없는 것과 비밀번호가 틀린 것을 **같은 응답**으로 알린다 —
 * 구분해서 알려주면 "이 이메일로 가입된 계정이 있는지"를 외부에서
 * 알아낼 수 있다(계정 존재 여부 추측 공격).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const admin = createAdminClient();

  const gate = await gateSiteProject(admin, slug);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: WRONG_CREDENTIALS }, { status: 401 });
  }

  const siteUser = await findSiteUserByEmail(admin, { projectId: gate.project.id, email });
  if (!siteUser) {
    return NextResponse.json({ error: WRONG_CREDENTIALS }, { status: 401 });
  }

  const passwordOk = await verifyPassword(password, siteUser.passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: WRONG_CREDENTIALS }, { status: 401 });
  }

  // 비밀번호까지 맞았을 때만 정지 사실을 알린다 — 그 전에 알리면
  // "이 이메일 계정이 정지됐다"는 것을 비밀번호 없이도 알아낼 수 있다.
  if (siteUser.suspendedAt) {
    return NextResponse.json(
      { error: `이 계정은 이용이 제한되었습니다: ${siteUser.suspendedReason ?? "사유 미기재"}` },
      { status: 403 },
    );
  }

  const token = signSiteSession({ siteUserId: siteUser.id, projectId: gate.project.id });

  const response = NextResponse.json({ email: siteUser.email, displayName: siteUser.displayName });
  response.cookies.set(SITE_SESSION_COOKIE, token, siteSessionCookieOptions(slug));
  return response;
}
