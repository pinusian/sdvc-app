import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerPageAccess } from "@/lib/auth/learner-page-guard";
import { getConversation, listMessages } from "@/lib/conversations/store";
import { getProjectById } from "@/lib/projects/store";
import { createDocumentWorkflowStore } from "@/lib/sdvc/document-store";
import { getDocumentWorkflowView } from "@/lib/sdvc/document-state";
import { ChatView } from "@/components/chat/ChatView";

/**
 * [P3-5] SDVC 대화 화면.
 *
 * 경로는 지금 `/conversations/[id]`다. plan.md에 적힌 `/projects/[id]/chat`은
 * projects 표가 생기는 [P4-2] 이후로 미룬다 — 슬라이스 2에는 아직 프로젝트
 * 개념이 없기 때문이다.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireLearnerPageAccess();

  const { id } = await params;
  const admin = createAdminClient();

  const conversation = await getConversation(admin, id, user.id);
  if (!conversation) {
    notFound();
  }

  const messages = await listMessages(admin, id);
  const linkedProject = conversation.projectId
    ? await getProjectById(admin, conversation.projectId, user.id)
    : null;
  const initialDocumentWorkflow = linkedProject
    ? await getDocumentWorkflowView(
        linkedProject.id,
        createDocumentWorkflowStore(admin),
      )
    : null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-7 py-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-serif text-lg font-semibold text-ink"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          SDVC
        </Link>
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-accent-ink">
          ← 내 프로젝트
        </Link>
      </header>

      <ChatView
        conversationId={conversation.id}
        currentBlock={conversation.currentBlock}
        initialMessages={messages}
        initialDocumentWorkflow={initialDocumentWorkflow}
      />
    </div>
  );
}
