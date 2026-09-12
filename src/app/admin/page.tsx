import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { adminEntry, loadAdminActor } from "@/lib/admin/entry";
import { recordAdminAction } from "@/lib/admin/audit";
import { listDevelopers } from "@/lib/admin/developers";
import { summarizeEconomics, type UsageRow } from "@/lib/admin/economics";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminLogin } from "./AdminLogin";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";

/**
 * [P8-2][P8-3] 운영 화면 (FR-014·015), [P8-11] 관리자 입구 (FR-038·039).
 *
 * 세 갈래다: 로그인을 받거나, 콘솔을 열거나, 없는 척한다. 판정은
 * `adminEntry` 한 곳에서 하고 여기서는 그 결과대로 그리기만 한다.
 *
 * **관리자가 아니면 404** — 403은 "여기 관리자 화면이 있다"는 사실을 알려준다.
 * 화면을 여는 것 자체가 남의 정보를 보는 일이므로 감사 로그에 남긴다.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const actor = user ? await loadAdminActor(admin, user.id) : null;
  const entry = adminEntry(actor);

  // 로그인하지 않았으면 `/login`으로 튕기지 않고 이 자리에서 받는다 (FR-038).
  if (entry === "login") return <AdminLogin />;
  if (entry !== "console") notFound();

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
    actorId: user!.id,
    action: "developer:read",
    detail: { via: "/admin", count: developers.length },
  });

  return (
    <AdminShell
      email={user!.email ?? ""}
      tier={actor!.adminTier}
      logout={
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="secondary"
            className="!border-white/25 !bg-transparent !px-3 !py-1.5 text-xs !text-surface hover:!border-white hover:!text-surface"
          >
            로그아웃
          </Button>
        </form>
      }
    >
      <AdminConsole summary={summary} developers={developers} />
    </AdminShell>
  );
}
