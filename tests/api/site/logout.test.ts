import { describe, expect, it } from "vitest";

/**
 * [BL-027] POST /api/site/[slug]/auth/logout — 방문자 로그아웃.
 *
 * Story-Doing 화면에 "로그아웃 기능은 아직 제공되지 않습니다"라고 적혀
 * 있었다 — [P11-2]가 로그인·가입은 만들었지만 로그아웃은 빠뜨렸다.
 *
 * 로그아웃은 쿠키를 지우는 일이라 프로젝트 존재 여부를 확인할 이유가
 * 없다(누구에게도 아무 정보도 새지 않는다) — 항상 성공한다. DB도
 * 건드리지 않는다.
 */

const context = { params: Promise.resolve({ slug: "story-doing" }) };

function request() {
  return new Request("http://localhost:3000/api/site/story-doing/auth/logout", {
    method: "POST",
  });
}

describe("[BL-027] POST /api/site/[slug]/auth/logout", () => {
  it("200과 함께 세션 쿠키를 지운다(같은 path로, Max-Age 0)", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/logout/route");
    const res = await POST(request(), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sdvc_site_session=");
    // /api/site/{slug}로 심었으니([BL-026]) 지울 때도 같은 path여야
    // 브라우저가 실제로 지운다 — path가 다르면 새 쿠키가 하나 더 생길 뿐이다.
    expect(setCookie).toContain("Path=/api/site/story-doing");
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it("로그인돼 있지 않아도(쿠키가 없어도) 그냥 성공한다 — 항상 안전하게 끝난다", async () => {
    const { POST } = await import("@/app/api/site/[slug]/auth/logout/route");
    const res = await POST(request(), context);
    expect(res.status).toBe(200);
  });
});
