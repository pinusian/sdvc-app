import { createAdminClient, createClient } from "@/lib/supabase/server";
import { adminCan } from "@/lib/admin/access";
import { adminEntry, loadAdminActor } from "@/lib/admin/entry";
import { recordAdminAction } from "@/lib/admin/audit";
import { listReports } from "@/lib/reports/store";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/reports/policy";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReportInbox, type InboxRow } from "@/components/admin/ReportInbox";
import { AdminLoginPanel } from "../AdminLoginPanel";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";

/**
 * [P8-5] 신고 접수함 (FR-013·043·044).
 *
 * Clarify 17에서 보내는 쪽(P7-5)과 함께 미뤄둔 건이다 — "받아만 두고 아무도
 * 안 보면 신고한 사람에게 더 나쁘다". 그래서 둘을 같이 낸다.
 *
 * 이 화면을 만들며 **`setProjectBlocked`(FR-016)가 어디에서도 불리지 않는다**는
 * 것도 드러났다. 부적절한 산출물을 신고받고 손댈 수 없으면 접수함은 반쪽이라
 * 함께 배선했다.
 */

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const picked = REPORT_STATUSES.find((s) => s.value === status)?.value as ReportStatus | undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const actor = user ? await loadAdminActor(admin, user.id) : null;

  if (adminEntry(actor) !== "console") {
    return <AdminLoginPanel signedInAs={user?.email ?? null} />;
  }

  const logout = (
    <form action={logoutAction}>
      <Button
        type="submit"
        variant="secondary"
        className="!border-white/25 !bg-transparent !px-3 !py-1.5 text-xs !text-surface hover:!border-white hover:!text-surface"
      >
        로그아웃
      </Button>
    </form>
  );

  const shellProps = {
    email: user!.email ?? "",
    tier: actor!.adminTier,
    logout,
    canReadAudit: adminCan(actor!, "audit:read"),
    canReadReports: adminCan(actor!, "report:read"),
  };

  // 등급이 모자라면 404가 아니라 이유를 말한다 — **거부된 시도도 증거다**.
  if (!adminCan(actor!, "report:read")) {
    await recordAdminAction(admin, {
      actorId: user!.id,
      action: "report:read",
      succeeded: false,
      detail: { denied: "등급 부족", tier: actor!.adminTier, via: "/admin/reports" },
    });

    return (
      <AdminShell {...shellProps}>
        <h1 className="mb-2">신고 접수함</h1>
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
          이 등급으로는 신고를 볼 수 없습니다.
        </p>
      </AdminShell>
    );
  }

  const reports = await listReports(admin, { status: picked });

  // 지목된 산출물이 지금 가려져 있는지 함께 읽는다 — 화면이 현재 상태를
  // 모르면 운영자가 이미 가린 것을 또 가린다.
  const projectIds = [...new Set(reports.map((r) => r.targetProjectId).filter(Boolean))] as string[];
  const blocked = new Set<string>();
  if (projectIds.length > 0) {
    const { data } = await admin
      .from("projects")
      .select("id, blocked_at")
      .in("id", projectIds);
    for (const row of (data ?? []) as { id: string; blocked_at: string | null }[]) {
      if (row.blocked_at) blocked.add(row.id);
    }
  }

  const rows: InboxRow[] = reports.map((r) => ({
    id: r.id,
    reporterEmail: r.reporterEmail,
    category: r.category,
    body: r.body,
    targetUrl: r.targetUrl,
    targetProjectId: r.targetProjectId,
    targetBlocked: r.targetProjectId ? blocked.has(r.targetProjectId) : false,
    status: r.status,
    adminNote: r.adminNote,
    createdAt: r.createdAt,
  }));

  const waiting = rows.filter((r) => r.status === "open" || r.status === "in_progress").length;

  await recordAdminAction(admin, {
    actorId: user!.id,
    action: "report:read",
    detail: { via: "/admin/reports", count: rows.length, status: picked ?? null },
  });

  return (
    <AdminShell {...shellProps}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1">신고 접수함</h1>
          <p className="text-sm text-ink-muted">
            답변은 신고한 분에게 그대로 보입니다. 부적절한 산출물은 지우지 않고 가립니다.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          {picked ? `${rows.length}건` : `처리 대기 ${waiting}건 · 전체 ${rows.length}건`}
        </p>
      </div>

      {/* 자바스크립트 없이 도는 GET 폼 — 감사 화면과 같은 방식 */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-ink-muted">
          상태
          <select
            name="status"
            defaultValue={picked ?? ""}
            className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
          >
            <option value="">전체</option>
            {REPORT_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" className="!px-3 !py-1 text-xs">
          걸러보기
        </Button>
      </form>

      <ReportInbox
        reports={rows}
        canHandle={adminCan(actor!, "report:handle")}
        canBlock={adminCan(actor!, "artifact:block")}
      />
    </AdminShell>
  );
}
