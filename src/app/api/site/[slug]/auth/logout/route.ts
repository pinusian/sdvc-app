import { NextResponse } from "next/server";
import { SITE_SESSION_COOKIE, siteSessionCookieOptions } from "@/lib/site-accounts/cookie";

/**
 * [BL-027] POST /api/site/[slug]/auth/logout — 방문자 로그아웃.
 *
 * [P11-2]가 로그인·가입은 만들었지만 로그아웃을 빠뜨렸었다. 쿠키를
 * 지우는 일이라 프로젝트 존재 여부를 확인할 이유가 없다(누구에게도
 * 아무 정보도 새지 않는다) — DB를 건드리지 않고 항상 성공한다.
 *
 * 쿠키를 심을 때와 **같은 path**로 지워야 브라우저가 실제로 지운다
 * ([BL-026]에서 path를 `/api/site/{slug}`로 맞춘 것과 같은 이유) —
 * path가 다르면 지우는 게 아니라 새 쿠키가 하나 더 생긴다.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SITE_SESSION_COOKIE, "", { ...siteSessionCookieOptions(slug), maxAge: 0 });
  return response;
}
