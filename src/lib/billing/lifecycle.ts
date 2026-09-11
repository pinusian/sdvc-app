import type { SupabaseClient } from "@supabase/supabase-js";
import type { Visibility } from "@/lib/projects/store";

/**
 * [P6-7] 구독 해지·체험 만료 시 산출물 처리 (FR-023·FR-027).
 *
 * 정책: **즉시 비공개 → 유예 후 삭제.** 유예 안에 결제하면 원래 공개범위
 * 그대로 복구된다. 그래서 잠글 때 원래 값을 `locked_from_visibility`에
 * 기억해 둔다 — 이게 없으면 복구해도 전부 비공개로만 남는다.
 */

export type LockReason = "canceled" | "trial_expired";

/** 유예 기간(일). 돈을 냈던 사람에게 더 길게 준다. */
export const GRACE_DAYS: Record<LockReason, number> = {
  canceled: 30,
  trial_expired: 10,
};

interface ProjectRow {
  id: string;
  visibility: Visibility;
  locked_from_visibility: Visibility | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function lockArtifacts(
  admin: SupabaseClient,
  userId: string,
  reason: LockReason,
  now: Date = new Date(),
): Promise<{ lockedCount: number; purgeAfter: string }> {
  const projects = await listProjects(admin, userId);

  let lockedCount = 0;
  for (const project of projects) {
    // 이미 잠긴 것(원래 값이 기억돼 있음)은 다시 잠그지 않는다 —
    // 덮어쓰면 "원래 공개였다"는 기억이 사라져 복구해도 안 열린다.
    if (project.locked_from_visibility !== null) continue;
    if (project.visibility === "private") continue; // 원래 비공개면 할 일 없음

    await admin
      .from("projects")
      .update({ visibility: "private", locked_from_visibility: project.visibility })
      .eq("id", project.id);
    lockedCount += 1;
  }

  const purgeAfter = new Date(now.getTime() + GRACE_DAYS[reason] * DAY_MS).toISOString();
  await admin
    .from("profiles")
    .update({ artifacts_locked_at: now.toISOString(), artifacts_purge_after: purgeAfter })
    .eq("id", userId);

  return { lockedCount, purgeAfter };
}

export async function restoreArtifacts(
  admin: SupabaseClient,
  userId: string,
): Promise<{ restoredCount: number }> {
  const projects = await listProjects(admin, userId);

  let restoredCount = 0;
  for (const project of projects) {
    if (project.locked_from_visibility === null) continue;

    await admin
      .from("projects")
      .update({
        visibility: project.locked_from_visibility,
        locked_from_visibility: null,
      })
      .eq("id", project.id);
    restoredCount += 1;
  }

  await admin
    .from("profiles")
    .update({ artifacts_locked_at: null, artifacts_purge_after: null })
    .eq("id", userId);

  return { restoredCount };
}

async function listProjects(admin: SupabaseClient, userId: string): Promise<ProjectRow[]> {
  const { data, error } = await admin
    .from("projects")
    .select("id, visibility, locked_from_visibility")
    .eq("owner_id", userId);

  if (error) throw new Error(`프로젝트 조회 실패: ${error.message}`);
  return (data ?? []) as ProjectRow[];
}
