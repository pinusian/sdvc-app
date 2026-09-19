import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { getProjectById } from "@/lib/projects/store";
import { listVersions, restoreVersion, saveVersion } from "@/lib/versions/store";
import { appendMessage, findConversationsByProjects } from "@/lib/conversations/store";

/**
 * [P7-6b] 되돌리기 (FR-012).
 *
 * GET  — 보관된 버전 목록 (최신부터)
 * POST — 그 버전으로 되돌린다
 *
 * 소유권 검사는 공개범위·이름 변경과 같다 — 남의 프로젝트를 되돌릴 수 있으면
 * 남의 홈페이지를 마음대로 과거로 돌려버릴 수 있다.
 */

/** 버전 이름은 우리가 만든 네 자리 숫자뿐이다. 경로를 벗어나지 못하게 막는다. */
const VERSION_PATTERN = /^\d{4}$/;

async function requireProject(id: string) {
  const access = await requireLearnerAccess();
  if (!access.ok) return { error: access.response };
  const { user } = access;

  const admin = createAdminClient();
  const project = await getProjectById(admin, id, user.id);
  if (!project) {
    return {
      error: NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }),
    };
  }

  return { admin, project };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await requireProject(id);
  if (found.error) return found.error;

  const versions = await listVersions(found.admin, found.project.id);
  return NextResponse.json({
    versions: versions.map((entry) => ({
      name: entry.name,
      at: entry.meta?.at ?? null,
      request: entry.meta?.request ?? "",
    })),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await requireProject(id);
  if (found.error) return found.error;

  let version: unknown;
  try {
    ({ version } = (await request.json()) as { version?: unknown });
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    return NextResponse.json({ error: "되돌릴 버전을 찾을 수 없습니다." }, { status: 400 });
  }

  // 되돌리기 **전에** 지금 상태를 남긴다 — 이게 없으면 "되돌리기를 취소"할 수 없다.
  try {
    await saveVersion(found.admin, {
      projectId: found.project.id,
      request: `되돌리기 직전 상태 (${version}로 되돌림)`,
    });
  } catch {
    // 사본을 못 남겼다고 되돌리기 자체를 막지는 않는다. 사용자가 원한 건 되돌리기다.
  }

  let result: { fileCount: number; removedCount: number };
  try {
    result = await restoreVersion(found.admin, { projectId: found.project.id, version });
  } catch (error) {
    const message = error instanceof Error ? error.message : "되돌리지 못했습니다.";
    const status = message.includes("찾을 수 없") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  // [BL-019] 되돌린 사실을 **대화 자체에도** 남긴다. 파일은 실제로
  // 되돌아갔는데, 이어서 대화에서 "제목 옆에 안내를 붙여주세요"처럼
  // 사소한 걸 더 고치면 모델이 몇 턴 전 자기 말(되돌리기 전 상태)을
  // 되살려 저장하는 일이 있었다 — [BL-018]의 "지금 파일이 대화 기록보다
  // 정확하다"는 시스템 프롬프트 각주보다, 여러 턴에 걸친 대화 자체가
  // 모델에게 더 강하게 작용했다.
  //
  // 그래서 시스템 프롬프트가 아니라 **대화의 한 턴으로** 남긴다 — 모델이
  // 방금 자기 입으로 한 말은 몇 턴 전의 말보다 강하다. 사람이 "그건 없던
  // 일로 하고" 라고 대화 중에 말하는 것과 같은 자리다.
  try {
    const target = await listVersions(found.admin, found.project.id);
    const restored = target.find((entry) => entry.name === version);
    const conversations = await findConversationsByProjects(
      found.admin,
      [found.project.id],
      found.project.ownerId,
    );
    const conversationId = conversations[found.project.id];

    if (conversationId) {
      const when = restored?.meta?.request ? `"${restored.meta.request}"` : "이전";
      await appendMessage(found.admin, {
        conversationId,
        role: "assistant",
        content:
          `⏪ 방금 ${when} 시점으로 되돌렸습니다. 지금 파일은 그 상태입니다 — ` +
          `그 이후에 이 대화에서 나온 변경 내용은 더 이상 적용되어 있지 않습니다.`,
      });
    }
  } catch {
    // 안내를 못 남겨도 되돌리기 자체는 이미 끝났다 — 사용자가 원한 건 되돌리기다.
  }

  return NextResponse.json({ version, ...result });
}
