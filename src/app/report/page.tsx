import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canSubmitReport } from "@/lib/reports/policy";
import { countOpenReports, listMyReports } from "@/lib/reports/store";
import { canOpenAdminConsole } from "@/lib/admin/entry";
import type { AdminTier } from "@/lib/admin/access";
import { AppHeader } from "@/components/layout/AppHeader";
import { ReportForm } from "@/components/reports/ReportForm";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";

/**
 * [P8-5e] 신고 창구 (FR-013·042·044).
 *
 * 보내는 곳과 결과를 보는 곳을 한 화면에 둔다 — 결과를 따로 찾아가야 하면
 * 아무도 안 본다.
 */
export default async function ReportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, admin_tier, suspended_at")
    .eq("id", user.id)
    .maybeSingle();
  const row = profile as
    | { role: string; admin_tier: string | null; suspended_at: string | null }
    | null;

  // `reports`는 RLS 정책이 없어 브라우저 키로는 못 읽는다 — 서버가 secret key로
  // 읽되 소유자 조건은 store가 직접 건다([P8-5b]).
  const admin = createAdminClient();
  const mine = await listMyReports(admin, user.id);

  const gate = canSubmitReport({
    suspendedAt: row?.suspended_at ?? null,
    openReports: await countOpenReports(admin, user.id),
  });

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader
        isAdmin={canOpenAdminConsole({
          role: row?.role ?? "",
          adminTier: (row?.admin_tier ?? null) as AdminTier | null,
          suspendedAt: row?.suspended_at ?? null,
        })}
      >
        <form action={logoutAction}>
          <Button type="submit" variant="secondary" className="!px-3 !py-1.5 text-xs">
            로그아웃
          </Button>
        </form>
      </AppHeader>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-7 py-10">
        <h1 className="mb-6">신고하기</h1>
        <ReportForm
          initial={mine.map((r) => ({
            id: r.id,
            category: r.category,
            body: r.body,
            targetUrl: r.targetUrl,
            status: r.status,
            adminNote: r.adminNote,
            createdAt: r.createdAt,
            handledAt: r.handledAt,
          }))}
          canSubmit={gate.allowed}
          blockReason={gate.allowed ? null : gate.reason}
        />
      </main>
    </div>
  );
}
