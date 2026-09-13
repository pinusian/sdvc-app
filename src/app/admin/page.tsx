import { createAdminClient, createClient } from "@/lib/supabase/server";
import { adminEntry, loadAdminActor } from "@/lib/admin/entry";
import { adminCan } from "@/lib/admin/access";
import { recordAdminAction } from "@/lib/admin/audit";
import { listDevelopers } from "@/lib/admin/developers";
import { listAllProjectsForAdmin } from "@/lib/admin/projects";
import { summarizeEconomics, type UsageRow } from "@/lib/admin/economics";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminLoginPanel } from "./AdminLoginPanel";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";

/**
 * [P8-2][P8-3] 운영 화면 (FR-014·015), [P8-11] 관리자 입구 (FR-038·039).
 *
 * 두 갈래다: 콘솔을 열거나, 그 자리에서 로그인을 받거나. 판정은
 * `adminEntry` 한 곳에서 하고 여기서는 그 결과대로 그리기만 한다.
 *
 * 화면을 여는 것 자체가 남의 정보를 보는 일이므로 감사 로그에 남긴다.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const actor = user ? await loadAdminActor(admin, user.id) : null;

  // `/login`으로 튕기지 않고 이 자리에서 받는다 (FR-038). 자격 없는 계정으로
  // 들어왔으면 맨 404 대신 **지금 누구인지**를 알려준다 (Clarify 30).
  if (adminEntry(actor) !== "console") {
    return <AdminLoginPanel signedInAs={user?.email ?? null} />;
  }

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

  // [P8-13] 전체 프로젝트 열람 (FR-045). "운영자(최고관리자)는 개발자들이
  // 만든 모든 프로젝트를 유지보수 차원에서 볼 수 있으면 좋겠다"는 요청
  // 그대로 — 감사 로그와 같은 민감도라 최고관리자만 본다.
  const canViewAllProjects = adminCan(actor!, "project:view_any");
  const allProjects = canViewAllProjects ? await listAllProjectsForAdmin(admin) : undefined;

  if (canViewAllProjects) {
    await recordAdminAction(admin, {
      actorId: user!.id,
      action: "project:view_any",
      detail: { via: "/admin", count: allProjects!.length },
    });
  }

  return (
    <AdminShell
      email={user!.email ?? ""}
      tier={actor!.adminTier}
      canReadAudit={adminCan(actor!, "audit:read")}
      canReadReports={adminCan(actor!, "report:read")}
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
      <AdminConsole summary={summary} developers={developers} allProjects={allProjects} />
    </AdminShell>
  );
}
