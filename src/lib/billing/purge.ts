import type { SupabaseClient } from "@supabase/supabase-js";
import { lockArtifacts } from "@/lib/billing/lifecycle";
import { deleteArtifactFiles } from "@/lib/artifacts/storage";

/**
 * [P6-7b] 유예 만료 처리 — 하루 한 번 도는 예약 작업이 부른다.
 *
 * ① 체험이 끝났는데 결제하지 않은 사람의 산출물을 잠근다 (FR-027)
 * ② 유예 기한이 지난 사람의 산출물을 **삭제**한다 (FR-023·FR-027)
 *
 * 삭제는 되돌릴 수 없다. 그래서 **기한이 확실히 지난 것만** 지우고,
 * 한 사람에서 실패해도 나머지는 계속 처리한다(한 명 때문에 전체가 멈추면
 * 다음 날까지 아무도 정리되지 않는다).
 */

export interface SweepResult {
  locked: number;
  purgedProjects: number;
  failed: number;
}

export async function runLifecycleSweep(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<SweepResult> {
  const result: SweepResult = { locked: 0, purgedProjects: 0, failed: 0 };

  // ① 체험 만료 + 미결제 + 아직 잠기지 않음
  const { data: expiredTrials } = await admin
    .from("profiles")
    .select("id")
    .eq("subscription_status", "none")
    .lt("trial_ends_at", now.toISOString())
    .is("artifacts_locked_at", null);

  for (const profile of (expiredTrials ?? []) as { id: string }[]) {
    try {
      await lockArtifacts(admin, profile.id, "trial_expired", now);
      result.locked += 1;
    } catch {
      result.failed += 1;
    }
  }

  // ② 유예 기한이 지난 사람 — 파일과 기록을 지운다
  const { data: duePurge } = await admin
    .from("profiles")
    .select("id")
    .not("artifacts_purge_after", "is", null)
    .lte("artifacts_purge_after", now.toISOString());

  for (const profile of (duePurge ?? []) as { id: string }[]) {
    const { data: projects } = await admin
      .from("projects")
      .select("id")
      .eq("owner_id", profile.id);

    for (const project of (projects ?? []) as { id: string }[]) {
      try {
        // 파일 먼저, 기록 나중 — 반대면 주인 없는 파일이 남는다([P4-3]과 같은 순서).
        await deleteArtifactFiles(admin, project.id);
        await admin.from("projects").delete().eq("id", project.id);
        result.purgedProjects += 1;
      } catch {
        // 파일을 못 지웠으면 기록도 남긴다 — 다음 실행 때 다시 시도한다.
        result.failed += 1;
      }
    }

    // 다 지웠으면 유예 표시를 거둔다(남겨두면 매일 같은 사람을 다시 훑는다).
    if (result.failed === 0) {
      await admin
        .from("profiles")
        .update({ artifacts_purge_after: null })
        .eq("id", profile.id);
    }
  }

  return result;
}
