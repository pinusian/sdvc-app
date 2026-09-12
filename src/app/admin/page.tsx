import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { adminCan, type AdminActor } from "@/lib/admin/access";
import { recordAdminAction } from "@/lib/admin/audit";
import { listDevelopers } from "@/lib/admin/developers";
import { summarizeEconomics, type UsageRow } from "@/lib/admin/economics";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";

/**
 * [P8-2][P8-3] 운영 화면 (FR-014·015).
 *
 * **관리자가 아니면 404** — 403은 "여기 관리자 화면이 있다"는 사실을 알려준다.
 * 화면을 여는 것 자체가 남의 정보를 보는 일이므로 감사 로그에 남긴다.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("role, admin_tier, suspended_at")
    .eq("id", user.id)
    .maybeSingle();

  const row = data as
    | { role: string; admin_tier: string | null; suspended_at: string | null }
    | null;
  const actor: AdminActor = {
    role: row?.role ?? "",
    adminTier: (row?.admin_tier ?? null) as AdminActor["adminTier"],
    suspendedAt: row?.suspended_at ?? null,
  };

  if (!adminCan(actor, "developer:read")) notFound();

  const developers = await listDevelopers(admin);

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  ).toISOString();
  const { data: usage } = await admin
    .from("usage_logs")
    .select("user_id, cost_usd")
    .gte("created_at", monthStart);

  const summary = summarizeEconomics({
    usage: (usage ?? []) as UsageRow[],
    accounts: developers,
  });

  // 화면을 연 것도 열람이다(Clarify 20).
  await recordAdminAction(admin, {
    actorId: user.id,
    action: "developer:read",
    detail: { via: "/admin", count: developers.length },
  });

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-7 py-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          SDVC <span className="text-sm font-normal text-ink-muted">운영</span>
        </Link>
        <form action={logoutAction}>
          <Button type="submit" variant="secondary" className="!px-3 !py-1.5 text-xs">
            로그아웃
          </Button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-[960px] flex-1 px-7 py-8">
        <AdminConsole summary={summary} developers={developers} />
      </main>
    </div>
  );
}
