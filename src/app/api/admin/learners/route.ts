import { NextResponse } from "next/server";
import { auditAndWarn, requireAdmin } from "@/lib/admin/guard";
import { listLearnerOverviews } from "@/lib/admin/learners";

/** 관리자 전용 수강생 목록·검색·상세 API (FR-021). */
export async function GET(request: Request) {
  const guard = await requireAdmin("developer:read");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const search = params.get("search") ?? undefined;
  const learnerId = params.get("id") ?? undefined;
  const learners = await listLearnerOverviews(guard.ctx.admin, { search, learnerId });
  const warn = await auditAndWarn(guard.ctx, {
    action: "developer:read",
    targetType: learnerId ? "profile" : undefined,
    targetId: learnerId,
    detail: {
      count: learners.length,
      ...(search?.trim() ? { search: search.trim() } : {}),
      ...(learnerId ? { view: "detail" } : { view: "list" }),
    },
  });

  if (learnerId) {
    const learner = learners[0];
    if (!learner) {
      return NextResponse.json({ error: "수강생을 찾을 수 없습니다.", ...warn }, { status: 404 });
    }
    return NextResponse.json({ learner, ...warn });
  }

  return NextResponse.json({ learners, ...warn });
}
