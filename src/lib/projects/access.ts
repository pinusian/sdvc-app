import type { Project } from "@/lib/projects/store";

/**
 * [P5-1] 산출물을 누가 볼 수 있는가 (FR-007).
 *
 * Storage 버킷 자체가 잠겨 있으므로([P4-1]) 이 함수가 **유일한 관문**이다.
 * 여기서 틀리면 비공개 홈페이지가 그대로 새어나간다 — [P2-6] `can()`과 같은
 * 원칙으로, 모르는 값이면 막는다(fail-closed).
 */
export function canViewArtifact(project: Project, viewerId: string | null): boolean {
  // 주인은 언제나 본다 (아직 만드는 중이어도 확인할 수 있어야 한다).
  if (viewerId && viewerId === project.ownerId) return true;

  // 완성되지 않은 것은 공개 설정이어도 남에게 보여주지 않는다.
  if (project.status !== "deployed") return false;

  return project.visibility === "link" || project.visibility === "public";
}
