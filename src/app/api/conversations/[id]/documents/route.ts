import { NextResponse } from "next/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { createAdminClient } from "@/lib/supabase/server";
import { getConversation } from "@/lib/conversations/store";
import { getProjectById } from "@/lib/projects/store";
import { createDocumentWorkflowStore } from "@/lib/sdvc/document-store";
import {
  approveDocumentAndAdvance,
  getDocumentWorkflowView,
} from "@/lib/sdvc/document-state";

type ApprovalKind = "plan" | "tasks";

async function ownedWorkflow(conversationId: string) {
  const access = await requireLearnerAccess();
  if (!access.ok) return { ok: false as const, response: access.response };

  const admin = createAdminClient();
  const conversation = await getConversation(admin, conversationId, access.user.id);
  if (!conversation?.projectId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "저장된 프로젝트 문서를 찾을 수 없습니다." }, { status: 404 }),
    };
  }

  const project = await getProjectById(admin, conversation.projectId, access.user.id);
  if (!project) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }),
    };
  }

  return {
    ok: true as const,
    admin,
    user: access.user,
    conversation,
    project,
    store: createDocumentWorkflowStore(admin),
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const owned = await ownedWorkflow(id);
  if (!owned.ok) return owned.response;

  return NextResponse.json(await getDocumentWorkflowView(owned.project.id, owned.store));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const owned = await ownedWorkflow(id);
  if (!owned.ok) return owned.response;

  let body: { kind?: unknown; versionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const kind = body.kind;
  const versionId = typeof body.versionId === "string" ? body.versionId : "";
  if ((kind !== "plan" && kind !== "tasks") || !versionId) {
    return NextResponse.json({ error: "승인할 문서와 버전을 선택해주세요." }, { status: 400 });
  }
  if (owned.conversation.currentBlock !== kind) {
    return NextResponse.json(
      { error: "현재 대화 단계의 문서만 승인할 수 있습니다." },
      { status: 409 },
    );
  }

  try {
    const transition = await approveDocumentAndAdvance(
      {
        projectId: owned.project.id,
        kind: kind as ApprovalKind,
        versionId,
        approvedBy: owned.user.id,
        now: new Date().toISOString(),
      },
      owned.store,
    );
    const view = await getDocumentWorkflowView(owned.project.id, owned.store);
    return NextResponse.json({
      ...view,
      currentStage: transition.currentStage,
      approvalCreated: transition.created,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "문서를 승인하지 못했습니다." },
      { status: 409 },
    );
  }
}
