import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/(auth)/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NewConversationButton } from "@/components/chat/NewConversationButton";

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

        <Card className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-ink-muted">아직 만든 프로젝트가 없어요.</p>
          <p className="text-sm text-ink-faint">
            &ldquo;새 프로젝트&rdquo;를 눌러 SDVC와 대화하며 첫 프로젝트를 만들어보세요.
          </p>
        </Card>
      </main>
    </div>
  );
}
