import { createAdminClient, createClient } from "@/lib/supabase/server";
import { adminCan } from "@/lib/admin/access";
import { adminEntry, loadAdminActor } from "@/lib/admin/entry";
import { listAuditLogs, recordAdminAction, resolvePeopleEmails } from "@/lib/admin/audit";
import { AUDIT_ACTION_OPTIONS, toAuditView } from "@/lib/admin/audit-view";
import { AdminShell } from "@/components/admin/AdminShell";
import { AuditLogTable } from "@/components/admin/AuditLogTable";
import { AdminLoginPanel } from "../AdminLoginPanel";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";

/**
 * [P8-7] 감사 기록 열람 (FR-017·041).
 *
 * 기록은 [P8-7a]부터 쌓여 왔지만 **볼 화면이 없었다** — DB를 직접 열어야만
 * 확인할 수 있었고, 그건 개발자가 곁에 있을 때만 가능한 방법이다.
 * `ensureAdminRole`이 불리지 않았던 것([BL-008])과 같은 종류의 미완성이다.
 *
 * **최고관리자만** 본다 — 누가 무엇을 보았는지의 기록 자체가 민감하다(FR-034).
 * 등급이 모자라면 404가 아니라 이유를 말한다: 이미 콘솔에 들어온 사람에게
 * 없는 척해봐야 가려지는 것은 없고 헷갈리기만 한다([P8-12]와 같은 원칙).
 */

const DEFAULT_LIMIT = 200;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; denied?: string; opens?: string }>;
}) {
  const { action, denied, opens } = await searchParams;

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

  // 등급이 모자란 경우 — **거부된 시도도 증거다**(guard.ts와 같은 처리).
  if (!adminCan(actor!, "audit:read")) {
    await recordAdminAction(admin, {
      actorId: user!.id,
      action: "audit:read",
      succeeded: false,
      detail: { denied: "등급 부족", tier: actor!.adminTier, via: "/admin/audit" },
    });

    return (
      <AdminShell email={user!.email ?? ""} tier={actor!.adminTier} logout={logout} canReadAudit={false}>
        <h1 className="mb-2">감사 기록</h1>
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
          이 등급으로는 감사 기록을 볼 수 없습니다. 누가 무엇을 보았는지의 기록 자체가
          민감하기 때문에 최고관리자만 열람합니다.
        </p>
      </AdminShell>
    );
  }

  const { rows, hiddenCount } = await listAuditLogs(admin, {
    action: action || undefined,
    succeeded: denied === "1" ? false : undefined,
    hideConsoleOpens: opens !== "1",
    limit: DEFAULT_LIMIT,
  });

  const emails = await resolvePeopleEmails(admin, rows.flatMap((r) => [r.actor_id, r.target_id]));
  const view = toAuditView(rows, emails);

  // 감사 기록을 본 것도 감사 기록에 남는다 (Clarify 20).
  await recordAdminAction(admin, {
    actorId: user!.id,
    action: "audit:read",
    detail: { via: "/admin/audit", count: rows.length, filter: { action, denied, opens } },
  });

  return (
    <AdminShell email={user!.email ?? ""} tier={actor!.adminTier} logout={logout} canReadAudit>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1">감사 기록</h1>
          <p className="text-sm text-ink-muted">
            누가 언제 누구에게 무엇을 했는지 — 거부된 시도까지 남습니다. 시각은 한국 기준입니다.
          </p>
        </div>
        <p className="text-xs text-ink-faint">최근 {view.length}건</p>
      </div>

      {/* 자바스크립트 없이 도는 평범한 GET 폼 — 기록을 보는 데 굳이 거들 것이 없다 */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-ink-muted">
          행위
          <select
            name="action"
            defaultValue={action ?? ""}
            className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
          >
            <option value="">전체</option>
            {AUDIT_ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-ink-muted">
          <input type="checkbox" name="denied" value="1" defaultChecked={denied === "1"} />
          거부된 시도만
        </label>

        <label className="flex items-center gap-1.5 text-ink-muted">
          <input type="checkbox" name="opens" value="1" defaultChecked={opens === "1"} />
          화면 열람 포함
        </label>

        <Button type="submit" variant="secondary" className="!px-3 !py-1 text-xs">
          걸러보기
        </Button>
      </form>

      <AuditLogTable rows={view} hiddenCount={hiddenCount} />
    </AdminShell>
  );
}
