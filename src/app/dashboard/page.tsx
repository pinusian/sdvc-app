import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";
import { NewConversationButton } from "@/components/chat/NewConversationButton";
import { ProjectList } from "@/components/projects/ProjectList";
import { listProjects } from "@/lib/projects/store";
import { findConversationsByProjects } from "@/lib/conversations/store";
import { AccountStatus } from "@/components/billing/AccountStatus";
import { loadAccountState } from "@/lib/billing/account";

const GRADE_LABEL: Record<string, string> = {
  trial: "체험",
  basic: "기본",
  pro: "프로",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, role, grade, trial_ends_at, stripe_customer_id")
    .eq("id", user.id)
    .single();

  const grade = profile?.grade ?? "trial";

  // projects는 RLS 정책이 없어 브라우저 키로는 못 읽는다([P4-2]) — 서버가
  // secret key로 읽되 소유자 조건은 store가 직접 건다.
  const admin = createAdminClient();
  const projects = await listProjects(admin, user.id);

  // [P5-4b] 각 프로젝트를 만든 대화로 돌아갈 수 있게 연결해준다 (FR-025) —
  // 버그 수정·기능 추가는 그 대화에서 이어서 하면 같은 프로젝트에 덮어쓴다.
  const conversationByProject = await findConversationsByProjects(
    admin,
    projects.map((project) => project.id),
    user.id,
  );
  const projectsWithConversation = projects.map((project) => ({
    ...project,
    conversationId: conversationByProject[project.id] ?? null,
  }));

  // [P6-8] 이용 상태는 차단 판정([P6-3])과 같은 근거로 보여준다 —
  // 화면과 판정이 어긋나면 "된다고 했는데 막힌다"가 생긴다.
  const account = await loadAccountState(admin, user.id);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-7 py-4">
        <div className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          SDVC
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="secondary" className="!px-3 !py-1.5 text-xs">
            로그아웃
          </Button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-[880px] flex-1 px-7 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-1">내 프로젝트</h1>
            <p className="text-sm text-ink-muted">
              {profile?.email ?? user.email} ·{" "}
              <span className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
                {GRADE_LABEL[grade] ?? grade} 등급
              </span>
            </p>
          </div>
          <NewConversationButton />
        </div>

        {checkout === "success" && (
          <p className="mb-6 rounded-lg border border-accent bg-accent-soft px-4 py-3 text-sm text-accent-ink">
            결제가 완료되었습니다. 등급 반영에 잠시 걸릴 수 있어요 — 그대로 보이면
            새로고침해주세요.
          </p>
        )}

        {account && (
          <AccountStatus
            grade={account.grade}
            subscriptionStatus={account.subscriptionStatus}
            trialEndsAt={account.trialEndsAt}
            monthlyTokensUsed={account.monthlyTokensUsed}
            projectCount={account.projectCount}
            canManage={Boolean(profile?.stripe_customer_id)}
          />
        )}

        <ProjectList projects={projectsWithConversation} />
      </main>
    </div>
  );
}
