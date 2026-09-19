import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { getProjectById, setProjectVisibility, type Visibility } from "@/lib/projects/store";

/**
 * [P5-3] 공개범위 변경 (FR-007).
 *
 * 비공개 ↔ 링크공개 ↔ 전체공개. 이 값 하나로 `/site/{주소}`가 누구에게
 * 열릴지가 결정되므로([P5-1] canViewArtifact), 세 값 외에는 받지 않는다.
 */
const ALLOWED: Visibility[] = ["private", "link", "public"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { user } = access;

  const { id } = await context.params;
  const admin = createAdminClient();

  const project = await getProjectById(admin, id, user.id);
  if (!project) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  let visibility: unknown;
  try {
    ({ visibility } = (await request.json()) as { visibility?: unknown });
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (typeof visibility !== "string" || !ALLOWED.includes(visibility as Visibility)) {
    return NextResponse.json(
      { error: "공개범위는 비공개·링크공개·전체공개 중 하나여야 합니다." },
      { status: 400 },
    );
  }

  await setProjectVisibility(admin, project.id, user.id, visibility as Visibility);
  return NextResponse.json({ visibility });
}
