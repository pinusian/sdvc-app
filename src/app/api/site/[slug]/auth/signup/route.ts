import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { gateSiteProject } from "@/lib/site-accounts/access";
import { findSiteUserByEmail, createSiteUser } from "@/lib/site-accounts/store";
import { hashPassword } from "@/lib/site-accounts/crypto";
import { signSiteSession } from "@/lib/site-accounts/session";
import { validateSignupInput } from "@/lib/auth/validation";
import { SITE_SESSION_COOKIE, siteSessionCookieOptions } from "@/lib/site-accounts/cookie";

/**
 * [P11-2] POST /api/site/[slug]/auth/signup — 사용자(방문자) 가입.
 *
 * 개발자 가입(Supabase Auth)과 완전히 분리된 체계다([P11-1]). 검증 함수는
 * [P2-5]에서 이미 만든 `validateSignupInput`을 그대로 재사용한다 — 이메일
 * 형식·비밀번호 최소 길이 규칙이 다를 이유가 없다.
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

  let body: { email?: unknown; password?: unknown; displayName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : undefined;

  const validation = validateSignupInput(email, password);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const existing = await findSiteUserByEmail(admin, { projectId: gate.project.id, email });
  if (existing) {
    return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const siteUser = await createSiteUser(admin, {
    projectId: gate.project.id,
    email,
    passwordHash,
    displayName,
  });

  const token = signSiteSession({ siteUserId: siteUser.id, projectId: gate.project.id });

  const response = NextResponse.json({ email: siteUser.email, displayName: siteUser.displayName });
  response.cookies.set(SITE_SESSION_COOKIE, token, siteSessionCookieOptions(slug));
  return response;
}
