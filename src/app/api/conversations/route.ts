import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { createConversation } from "@/lib/conversations/store";

/** [P3-4] 새 SDVC 대화를 시작한다. */
export async function POST(request: Request) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { user } = access;

  let title: string | undefined;
  try {
    const body = (await request.json()) as { title?: unknown };
    if (typeof body.title === "string" && body.title.trim()) title = body.title.trim();
  } catch {
    // 본문이 없어도 대화는 만들 수 있다 (제목은 나중에 붙일 수 있음).
  }

  const conversation = await createConversation(createAdminClient(), {
    ownerId: user.id,
    title,
  });

  return NextResponse.json(
    { id: conversation.id, currentBlock: conversation.currentBlock },
    { status: 201 },
  );
}
