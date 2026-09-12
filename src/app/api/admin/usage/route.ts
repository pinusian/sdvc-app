import { NextResponse } from "next/server";
import { requireAdmin, auditAndWarn } from "@/lib/admin/guard";
import { listDevelopers } from "@/lib/admin/developers";
import { summarizeEconomics, type UsageRow } from "@/lib/admin/economics";

/**
 * [P8-3] 적자를 보는 화면의 데이터 (FR-015, SC-007).
 *
 * 읽기 전용이므로 **지원 등급도** 볼 수 있다.
 */
export async function GET() {
  const guard = await requireAdmin("usage:read");
  if (!guard.ok) return guard.response;

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  ).toISOString();

  const { data, error } = await guard.ctx.admin
    .from("usage_logs")
    .select("user_id, cost_usd")
    .gte("created_at", monthStart);

  if (error) {
    return NextResponse.json(
      { error: `사용량 조회 실패: ${error.message}` },
      { status: 500 },
    );
  }

  const developers = await listDevelopers(guard.ctx.admin);
  const summary = summarizeEconomics({
    usage: (data ?? []) as UsageRow[],
    accounts: developers,
  });

  const warn = await auditAndWarn(guard.ctx, {
    action: "usage:read",
    detail: { month: monthStart, developers: developers.length },
  });

  return NextResponse.json({ summary, monthStart, ...warn });
}
