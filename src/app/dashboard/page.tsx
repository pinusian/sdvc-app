import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";
import { NewConversationButton } from "@/components/chat/NewConversationButton";
import { ProjectList } from "@/components/projects/ProjectList";
import { listProjects } from "@/lib/projects/store";

const GRADE_LABEL: Record<string, string> = {
  trial: "체험",
  basic: "기본",
  pro: "프로",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, role, grade, trial_ends_at")
    .eq("id", user.id)
    .single();

  const grade = profile?.grade ?? "trial";

  // projects는 RLS 정책이 없어 브라우저 키로는 못 읽는다([P4-2]) — 서버가
  // secret key로 읽되 소유자 조건은 store가 직접 건다.
  const projects = await listProjects(createAdminClient(), user.id);

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

        <ProjectList projects={projects} />
      </main>
    </div>
  );
}
