import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * [BL-016] 프로필이 없는 계정을 스스로 고친다 (FR-021).
 *
 * 가입자 2명에게 `profiles` 행이 없어 대화가 402 "계정 정보를 확인할 수
 * 없습니다"로 막혔다. 더 나쁜 것은 **운영 콘솔 목록에도 보이지 않았다**는
 * 점이다 — 목록이 `profiles`에서 오기 때문이다. 그 두 사람은 가입해 놓고
 * 못 쓰고 있었는데 운영자는 알 방법이 없었다.
 *
 * 가입 트리거(`handle_new_user`)는 지금 정상이다. 그래도 되풀이되면 또
 * 조용하므로, 사람이 알아채기를 기다리는 대신 **로그인할 때 스스로 낫게**
 * 한다 — `ensureAdminRole`을 로그인에 배선한 것([BL-008])과 같은 자리다.
 *
 * **`ensureAdminRole`보다 먼저 불러야 한다.** 그쪽은 `update`라서 행이
 * 없으면 0행을 고치고 조용히 지나간다.
 *
 * 반드시 secret key 클라이언트로 부른다 — `profiles` 쓰기는 [P2-7]에서
 * 브라우저 쪽으로는 전부 막았다.
 */

export type EnsureProfileResult =
  | { created: true }
  | { created: false; reason?: string };

/** 같은 순간에 두 번 들어와 부딪힌 경우 — 이미 있는 것이니 목적은 이뤄졌다. */
function isDuplicate(message: string): boolean {
  return /duplicate key|already exists|23505/i.test(message);
}

export async function ensureProfile(
  admin: SupabaseClient,
  userId: string,
  email: string | null | undefined,
): Promise<EnsureProfileResult> {
  try {
    // 누구인지 모르는 행을 남기지 않는다. 이메일은 목록·문의의 유일한 단서다.
    if (!email) {
      return { created: false, reason: "이메일을 알 수 없어 프로필을 만들지 않았습니다." };
    }

    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    // 있는지 모르는 채로 넣으면 멀쩡한 행을 건드릴 수 있다 — 모르면 멈춘다.
    if (error) return { created: false, reason: `프로필 확인 실패: ${error.message}` };
    if (data) return { created: false };

    // **등급·체험 기간은 넣지 않는다.** DB 기본값(체험 7일)이 하나뿐이어야
    // 트리거로 만든 계정과 여기서 만든 계정이 달라지지 않는다.
    const { error: insertError } = await admin
      .from("profiles")
      .insert({ id: userId, email });

    if (insertError) {
      return isDuplicate(insertError.message)
        ? { created: false }
        : { created: false, reason: `프로필 생성 실패: ${insertError.message}` };
    }

    return { created: true };
  } catch (error) {
    // 로그인을 막지 않는다 — 사용자가 원한 것은 로그인이다.
    return {
      created: false,
      reason: error instanceof Error ? error.message : "프로필을 만들지 못했습니다.",
    };
  }
}
