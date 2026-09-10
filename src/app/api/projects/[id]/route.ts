import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { deleteProjectRow, getProjectById } from "@/lib/projects/store";
import { deleteArtifactFiles } from "@/lib/artifacts/storage";

/**
 * [P4-3] 프로젝트 삭제 (FR-022).
 *
 * **파일을 먼저 지우고 기록을 나중에 지운다.** 순서가 바뀌면 기록이 사라진
 * 뒤 파일만 남아, 누구 것인지 알 수 없는 파일이 저장소에 영영 남는다.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await context.params;
  const admin = createAdminClient();

  const project = await getProjectById(admin, id, user.id);
  if (!project) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  let fileCount: number;
  try {
    fileCount = await deleteArtifactFiles(admin, project.id);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "파일 삭제에 실패했습니다.",
      },
      { status: 500 },
    );
  }

  const deleted = await deleteProjectRow(admin, project.id, user.id);
  return NextResponse.json({ deleted, fileCount });
}
