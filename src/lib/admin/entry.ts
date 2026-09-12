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
  /** 자격이 확인됐다 */
  | "console"
  /** 아직 아니다 — 그 자리에서 로그인을 받는다 */
  | "sign_in";

/**
 * [P8-12] 갈래를 **둘로 줄였다**.
 *
 * 처음에는 셋이었다: 로그인 안 한 사람에게는 로그인 화면, 자격 없는 사람에게는
 * 404. 숨기려는 뜻이었으나 **같은 주소가 로그아웃하면 로그인 화면을 내주므로
 * 애초에 숨겨지지 않았다** — 시크릿 창 하나면 누구나 확인한다.
 * 남은 것은 엉뚱한 계정으로 로그인한 운영자가 맨 404에 갇히는 손해뿐이었다.
 *
 * (API 라우트는 다르다 — `guard.ts`는 404를 그대로 쓴다. 기계가 두드리는
 * 자리에는 안내할 사람이 없고, 막다른 길이어도 잃을 것이 없다.)
 */
export function adminEntry(actor: AdminActor | null): AdminEntry {
  return canOpenAdminConsole(actor) ? "console" : "sign_in";
}

/**
 * 콘솔을 열 수 있는가. 화면의 입구 노출과 실제 진입이 **같은 판정**을 쓰게 한다 —
 * 눌러도 들어가지지 않는 링크는 없느니만 못하다 (FR-040).
 */
export function canOpenAdminConsole(actor: AdminActor | null): boolean {
  // 콘솔을 여는 것 자체가 남의 정보를 보는 일이므로 읽기 권한을 기준으로 삼는다.
  return actor !== null && adminCan(actor, "developer:read");
}

/**
 * 관리자 화면에서 로그인한 사람을 어디로 보낼 것인가.
 *
 * 관리자가 아니면 **말없이 자기 화면으로 보낸다.** 그 사람이 원한 것은
 * 어쨌든 로그인이었다 — 막다른 곳으로 보내지 않는다.
 */
export function landingAfterAdminLogin(actor: AdminActor | null): string {
  return canOpenAdminConsole(actor) ? "/admin" : "/dashboard";
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
