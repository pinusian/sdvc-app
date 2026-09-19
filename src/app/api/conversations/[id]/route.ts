import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { getConversation, listMessages } from "@/lib/conversations/store";

/**
 * [P3-4] 대화 하나를 불러온다 — 진행 단계와 지금까지의 메시지.
 * 새로고침하거나 며칠 뒤 다시 들어와도 이어서 진행할 수 있게 하는 통로.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { user } = access;

  const { id } = await context.params;
  const admin = createAdminClient();

  const conversation = await getConversation(admin, id, user.id);
  if (!conversation) {
    return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
  }

  const messages = await listMessages(admin, id);

  return NextResponse.json({
    id: conversation.id,
    currentBlock: conversation.currentBlock,
    messages,
  });
}
