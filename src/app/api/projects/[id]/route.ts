import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { deleteProjectRow, getProjectById, renameProject } from "@/lib/projects/store";
import { deleteArtifactFiles } from "@/lib/artifacts/storage";
import { deleteAllVersions } from "@/lib/versions/store";
import { findConversationsByProjects } from "@/lib/conversations/store";
import { deleteConversationAttachments } from "@/lib/attachments/store";
import { normalizeProjectName, MAX_NAME_LENGTH } from "@/lib/projects/name";

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

  // [P7-6c] 되돌리기용 사본에도 옛 홈페이지가 들어 있다 — 함께 지운다.
  // 실패해도 본편 삭제는 끝낸다(남은 사본은 정리 작업이 다시 치운다).
  try {
    await deleteAllVersions(admin, project.id);
  } catch {
    // 조용히 넘긴다 — 사용자가 원한 것은 프로젝트 삭제다.
  }

  // [BL-015] 이 프로젝트를 만든 대화에 붙였던 첨부도 함께 지운다.
  // `deleteConversationAttachments`는 [P7-8]부터 있었지만 대화 삭제 기능
  // 자체가 없어 부를 자리가 없었다 — attachments 버킷이 계속 커지고 있었다.
  // 프로젝트를 지울 때가 정리할 자연스러운 자리다. 여기도 실패해도 본편
  // 삭제는 끝낸다 — 사용자가 원한 건 프로젝트 삭제다.
  try {
    const conversations = await findConversationsByProjects(admin, [project.id], user.id);
    const conversationId = conversations[project.id];
    if (conversationId) {
      await deleteConversationAttachments(admin, user.id, conversationId);
    }
  } catch {
    // 조용히 넘긴다 — 남은 첨부는 이미 낮은 우선순위(BL-015)로 접수돼 있었다.
  }

  const deleted = await deleteProjectRow(admin, project.id, user.id);
  return NextResponse.json({ deleted, fileCount });
}

/**
 * [P7-1b] 이름 바꾸기 (FR-030).
 *
 * 공개범위 변경과 같은 소유권 검사를 쓴다 — 남의 프로젝트 이름을 바꿀 수
 * 있으면 목록이 남의 손에 흔들린다. 길이를 넘기면 잘라 저장하지 않고 거부한다.
 */
export async function PATCH(
  request: Request,
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

  let raw: unknown;
  try {
    ({ name: raw } = (await request.json()) as { name?: unknown });
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const name = normalizeProjectName(raw);
  if (!name) {
    return NextResponse.json(
      { error: `이름은 1자 이상 ${MAX_NAME_LENGTH}자 이하로 적어주세요.` },
      { status: 400 },
    );
  }

  await renameProject(admin, project.id, user.id, name);
  return NextResponse.json({ name });
}
