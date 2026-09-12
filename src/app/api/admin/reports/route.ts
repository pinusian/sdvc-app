import { NextResponse } from "next/server";
import { requireAdmin, auditAndWarn } from "@/lib/admin/guard";
import { adminCan } from "@/lib/admin/access";
import { listReports, updateReport } from "@/lib/reports/store";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/reports/policy";
import { setProjectBlocked } from "@/lib/projects/store";

/**
 * [P8-5d] 접수함 처리 (FR-043·044, FR-016).
 *
 * **가리기(FR-016)를 여기서 함께 배선한다.** `setProjectBlocked`는 [P8-0]에
 * 만들어 두고 **어디에서도 부르지 않았다** — `ensureAdminRole`(BL-008)과 같은
 * 미완성이었다. 부적절한 산출물을 신고받고도 손댈 수 없으면 접수함은
 * 반쪽이다.
 */

export async function GET(request: Request) {
  const guard = await requireAdmin("report:read");
  if (!guard.ok) return guard.response;

  const status = new URL(request.url).searchParams.get("status") as ReportStatus | null;
  const reports = await listReports(guard.ctx.admin, { status: status ?? undefined });

  const warn = await auditAndWarn(guard.ctx, {
    action: "report:read",
    detail: { via: "/api/admin/reports", count: reports.length, status },
  });

  return NextResponse.json({ reports, ...warn });
}

export async function POST(request: Request) {
  const guard = await requireAdmin("report:handle");
  if (!guard.ok) return guard.response;

  let payload: {
    reportId?: string;
    status?: string;
    adminNote?: string | null;
    blockProjectId?: string | null;
    blocked?: boolean;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  if (!payload.reportId) {
    return NextResponse.json({ error: "어느 신고인지 알려주세요." }, { status: 400 });
  }

  const status = REPORT_STATUSES.find((s) => s.value === payload.status)?.value;
  if (!status) {
    return NextResponse.json({ error: "모르는 상태입니다." }, { status: 400 });
  }

  // 신고를 처리하면서 산출물을 함께 가린다 — 권한은 따로 판정한다.
  let blockWarning: string | undefined;
  if (payload.blockProjectId) {
    if (!adminCan(guard.ctx.actor, "artifact:block")) {
      return NextResponse.json({ error: "산출물을 가릴 권한이 없습니다." }, { status: 403 });
    }

    const blocked = payload.blocked !== false;
    await setProjectBlocked(
      guard.ctx.admin,
      payload.blockProjectId,
      blocked,
      blocked ? `신고 처리 (${payload.reportId})` : null,
    );

    const warn = await auditAndWarn(guard.ctx, {
      action: "artifact:block",
      targetType: "project",
      targetId: payload.blockProjectId,
      detail: { blocked, reason: `신고 처리 (${payload.reportId})` },
    });
    blockWarning = warn.auditWarning;
  }

  const report = await updateReport(guard.ctx.admin, payload.reportId, {
    status,
    // 빈칸은 "답이 없음"이지 빈 문자열이 아니다.
    adminNote: payload.adminNote?.trim() ? payload.adminNote.trim() : null,
    handledBy: guard.ctx.actorId,
  });

  const warn = await auditAndWarn(guard.ctx, {
    action: "report:handle",
    targetType: "report",
    targetId: report.id,
    detail: { status, blocked: Boolean(payload.blockProjectId) },
  });

  return NextResponse.json({
    report,
    ...warn,
    ...(blockWarning && !warn.auditWarning ? { auditWarning: blockWarning } : {}),
  });
}
