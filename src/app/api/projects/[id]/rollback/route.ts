import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/projects/store";
import { listVersions, restoreVersion, saveVersion } from "@/lib/versions/store";

/**
 * [P7-6b] 되돌리기 (FR-012).
 *
 * GET  — 보관된 버전 목록 (최신부터)
 * POST — 그 버전으로 되돌린다
 *
 * 소유권 검사는 공개범위·이름 변경과 같다 — 남의 프로젝트를 되돌릴 수 있으면
 * 남의 홈페이지를 마음대로 과거로 돌려버릴 수 있다.
 */

/** 버전 이름은 우리가 만든 네 자리 숫자뿐이다. 경로를 벗어나지 못하게 막는다. */
const VERSION_PATTERN = /^\d{4}$/;

async function requireProject(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const project = await getProjectById(admin, id, user.id);
  if (!project) {
    return {
      error: NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }),
    };
  }

  return { admin, project };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await requireProject(id);
  if (found.error) return found.error;

  const versions = await listVersions(found.admin, found.project.id);
  return NextResponse.json({
    versions: versions.map((entry) => ({
      name: entry.name,
      at: entry.meta?.at ?? null,
      request: entry.meta?.request ?? "",
    })),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await requireProject(id);
  if (found.error) return found.error;

  let version: unknown;
  try {
    ({ version } = (await request.json()) as { version?: unknown });
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    return NextResponse.json({ error: "되돌릴 버전을 찾을 수 없습니다." }, { status: 400 });
  }

  // 되돌리기 **전에** 지금 상태를 남긴다 — 이게 없으면 "되돌리기를 취소"할 수 없다.
  try {
    await saveVersion(found.admin, {
      projectId: found.project.id,
      request: `되돌리기 직전 상태 (${version}로 되돌림)`,
    });
  } catch {
    // 사본을 못 남겼다고 되돌리기 자체를 막지는 않는다. 사용자가 원한 건 되돌리기다.
  }

  try {
    const result = await restoreVersion(found.admin, {
      projectId: found.project.id,
      version,
    });
    return NextResponse.json({ version, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "되돌리지 못했습니다.";
    const status = message.includes("찾을 수 없") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
