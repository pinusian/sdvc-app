import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectBySlug, type Project } from "@/lib/projects/store";

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
