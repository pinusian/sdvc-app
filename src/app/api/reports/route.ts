import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canSubmitReport, validateReport, type ReportCategory } from "@/lib/reports/policy";
import { countOpenReports, createReport } from "@/lib/reports/store";

/**
 * [P8-5d] 신고 접수 (FR-013·042).
 *
 * 판정은 `policy.ts`가 하고 여기는 사람과 저장소를 잇기만 한다 —
 * 화면에서도 같은 함수로 막으므로 규칙이 두 벌이 되지 않는다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let payload: { category?: string; body?: string; targetUrl?: string | null };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "신고 내용을 읽지 못했습니다." }, { status: 400 });
  }

  const checked = validateReport({
    category: payload.category as ReportCategory,
    body: payload.body ?? "",
    targetUrl: payload.targetUrl ?? null,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  // `reports`는 서버 전용(RLS 정책 없음)이라 secret key로 다룬다.
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("email, suspended_at")
    .eq("id", user.id)
    .maybeSingle();
  const row = profile as { email: string | null; suspended_at: string | null } | null;

  const gate = canSubmitReport({
    suspendedAt: row?.suspended_at ?? null,
    openReports: await countOpenReports(admin, user.id),
  });
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
  }

  const report = await createReport(admin, {
    reporterId: user.id,
    reporterEmail: row?.email ?? user.email ?? null,
    ...checked.value,
  });

  return NextResponse.json({ report }, { status: 201 });
}
