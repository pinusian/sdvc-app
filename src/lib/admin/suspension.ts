import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * [P8-6] 주인이 정지됐는가 (FR-014·016).
 *
 * 계정을 정지하면 그 사람의 산출물도 함께 가려져야 한다 — 계정만 막고
 * 홈페이지가 계속 서비스되면 정지의 의미가 없다.
 *
 * **모르면 막지 않는다**: 조회가 실패했다고 멀쩡한 홈페이지를 통째로
 * 내리면 피해가 더 크다. 정지는 드물고 조회 실패는 일시적이다.
 * (비교: 결제 판정은 반대로 막는 쪽이다 — 잘못 열어주면 원가가 샌다.)
 */
export async function isOwnerSuspended(
  admin: SupabaseClient,
  ownerId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("suspended_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (error || !data) return false;
  return Boolean((data as { suspended_at: string | null }).suspended_at);
}
