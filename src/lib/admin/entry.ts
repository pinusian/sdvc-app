import type { SupabaseClient } from "@supabase/supabase-js";
import { adminCan, type AdminActor, type AdminTier } from "./access";

/**
 * [P8-11] 관리자 입구 (FR-038).
 *
 * 관리자 화면은 **주소 하나로 들어간다**. 로그인하지 않았다고 `/login`으로
 * 튕기면, 관리자는 개발자 로그인 화면을 보고 주소도 바뀐 채로 남는다 —
 * "내가 어디로 들어온 것인가"를 매번 다시 확인해야 한다(BL-009).
 *
 * 판정을 여기 한 곳에 둔다. 나중에 감사 로그 열람 화면([P8-7]) 같은
 * 하위 화면이 늘 때, 한 군데가 빠지는 일이 생기지 않게 한다.
 */

export type AdminEntry =
  /** 로그인하지 않았다 — 그 자리에서 받는다 */
  | "login"
  /** 관리자다 */
  | "console"
  /** 관리자가 아니다 — 403이 아니라 404. 403은 "여기 관리자 화면이 있다"는 뜻이다 */
  | "not_found";

export function adminEntry(actor: AdminActor | null): AdminEntry {
  if (!actor) return "login";
  // 콘솔을 여는 것 자체가 남의 정보를 보는 일이므로 읽기 권한을 기준으로 삼는다.
  return adminCan(actor, "developer:read") ? "console" : "not_found";
}

/**
 * 관리자 화면에서 로그인한 사람을 어디로 보낼 것인가.
 *
 * 관리자가 아니면 **말없이 자기 화면으로 보낸다.** "관리자가 아닙니다"라고
 * 알려주는 것은 "여기 관리자 화면이 있다"고 알려주는 것과 같다 —
 * `not_found`와 같은 이유다. 막다른 404로 보내지도 않는다:
 * 그 사람이 원한 것은 어쨌든 로그인이었다.
 */
export function landingAfterAdminLogin(actor: AdminActor | null): string {
  return adminEntry(actor) === "console" ? "/admin" : "/dashboard";
}

interface ActorRow {
  role: string;
  admin_tier: string | null;
  suspended_at: string | null;
}

/**
 * 판정에 필요한 세 값만 읽는다.
 *
 * 프로필을 못 읽으면 **빈 역할**을 돌려준다 — `null`을 돌려주면 `adminEntry`가
 * "로그인하지 않았다"로 읽어 로그인 화면을 다시 보여주는 고리에 빠진다.
 */
export async function loadAdminActor(
  admin: SupabaseClient,
  userId: string,
): Promise<AdminActor> {
  const { data } = await admin
    .from("profiles")
    .select("role, admin_tier, suspended_at")
    .eq("id", userId)
    .maybeSingle();

  const row = data as ActorRow | null;
  return {
    role: row?.role ?? "",
    adminTier: (row?.admin_tier ?? null) as AdminTier | null,
    suspendedAt: row?.suspended_at ?? null,
  };
}
