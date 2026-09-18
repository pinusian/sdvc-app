import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectBySlug, type Project } from "@/lib/projects/store";
import { getSiteUserById } from "@/lib/site-accounts/store";
import { verifySiteSession } from "@/lib/site-accounts/session";
import { readSiteSessionCookie } from "@/lib/site-accounts/cookie";

/**
 * [P11-2] 사용자(방문자) API가 공통으로 거치는 문 — 가입·로그인·기록 API 전부
 * 이 문을 지난다. 로직을 한 곳에 모은다 — 라우트마다 따로 검사하면 언젠가
 * 하나를 빠뜨린다([P8-2]에서 관리자 검사를 한 관문으로 모은 것과 같은 이유).
 */

export type SiteProjectGate =
  | { ok: true; project: Project }
  | { ok: false; status: 404 | 403; error: string };

export async function gateSiteProject(
  admin: SupabaseClient,
  slug: string,
): Promise<SiteProjectGate> {
  const project = await getProjectBySlug(admin, slug);

  // [FR-016]과 같은 원칙: 없는 것과 막힌 것을 구분해서 알려주지 않는다
  // (존재 자체를 숨긴다). 아직 안 만들어진(draft 등) 프로젝트도 마찬가지다.
  if (!project || project.status !== "deployed" || project.blockedAt) {
    return { ok: false, status: 404, error: "페이지를 찾을 수 없습니다." };
  }

  if (!project.siteLoginEnabled) {
    return { ok: false, status: 403, error: "이 프로젝트는 지금 사용자 로그인을 받지 않습니다." };
  }

  return { ok: true, project };
}

export type SiteAuthResult =
  | { ok: true; project: Project; siteUserId: string }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * [P11-3] 기록 API(읽기·쓰기 전부)가 요청마다 거치는 관문. `gateSiteProject`로
 * 프로젝트 자체를 먼저 확인하고, 그다음 쿠키 → 서명 → 실제 계정(정지 여부
 * 포함) 순서로 "지금 이 사람이 맞는지"를 끝까지 확인한다.
 *
 * 세션이 유효해도 그 사이 계정이 정지될 수 있으므로([P11-6]), 토큰만
 * 믿지 않고 매번 `getSiteUserById`로 지금 상태를 다시 읽는다.
 */
export async function requireSiteUser(
  admin: SupabaseClient,
  slug: string,
  request: Request,
): Promise<SiteAuthResult> {
  const gate = await gateSiteProject(admin, slug);
  if (!gate.ok) return gate;

  const token = readSiteSessionCookie(request);
  if (!token) return { ok: false, status: 401, error: "로그인이 필요합니다." };

  const payload = verifySiteSession(token);
  if (!payload || payload.projectId !== gate.project.id) {
    return { ok: false, status: 401, error: "로그인이 필요합니다." };
  }

  const siteUser = await getSiteUserById(admin, payload.siteUserId);
  if (!siteUser || siteUser.projectId !== gate.project.id) {
    return { ok: false, status: 401, error: "로그인이 필요합니다." };
  }

  if (siteUser.suspendedAt) {
    return {
      ok: false,
      status: 403,
      error: `이 계정은 이용이 제한되었습니다: ${siteUser.suspendedReason ?? "사유 미기재"}`,
    };
  }

  return { ok: true, project: gate.project, siteUserId: siteUser.id };
}
