"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { signUpDeveloper } from "@/lib/auth/signup";
import { loginDeveloper } from "@/lib/auth/login";
import { ensureAdminRole } from "@/lib/auth/admin";
import { ensureProfile } from "@/lib/auth/profile";
import { requestPasswordReset } from "@/lib/auth/reset";
import { landingAfterAdminLogin, loadAdminActor } from "@/lib/admin/entry";

export type AuthActionState = { error: string | null };

async function siteOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function signupAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const origin = await siteOrigin();

  const result = await signUpDeveloper(supabase, email, password, `${origin}/verify-email`);
  if (!result.success) {
    return { error: result.error };
  }

  redirect("/verify-email?sent=1");
}

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const result = await loginDeveloper(supabase, email, password);
  if (!result.success) {
    return { error: result.error };
  }

  await healAccount(supabase);

  redirect("/dashboard");
}

/**
 * [BL-030] 비밀번호 찾기 요청 — 개발자·시스템관리자 공용(같은 Supabase Auth
 * 계정이라 화면도 하나다). 계정이 있든 없든 같은 화면으로 보낸다 —
 * `requestPasswordReset` 자체가 계정 존재 여부를 밝히지 않는다.
 */
export async function requestPasswordResetAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();

  const supabase = await createClient();
  const origin = await siteOrigin();

  const result = await requestPasswordReset(supabase, email, `${origin}/update-password`);
  if (!result.success) {
    return { error: result.error };
  }

  redirect("/forgot-password?sent=1");
}

/**
 * [P8-11c] 관리자 화면(`/admin`) 자리에서 받는 로그인 (FR-038).
 *
 * 평범한 로그인과 다른 것은 **착지점 하나**다. 관리자면 콘솔로, 아니면
 * 말없이 자기 화면으로 보낸다 — 여기서 "관리자가 아닙니다"라고 말하면
 * 관리자 화면의 존재를 알려주는 셈이다(Clarify 27).
 */
export async function adminLoginAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const result = await loginDeveloper(supabase, email, password);
  if (!result.success) {
    return { error: result.error };
  }

  await healAccount(supabase);

  redirect(await landingForCurrentUser(supabase));
}

/** 방금 로그인한 사람의 착지점. 못 읽으면 개발자 화면 — 막다른 404로 보내지 않는다. */
async function landingForCurrentUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return "/dashboard";

    return landingAfterAdminLogin(await loadAdminActor(createAdminClient(), user.id));
  } catch {
    return "/dashboard";
  }
}

/**
 * [BL-008] 서버관리자 자동 승격 (FR-024) + [BL-016] 프로필 자가 복구 (FR-021).
 *
 * `ensureAdminRole`은 [P2-7]에서 만들었지만 **어디에서도 부르지 않았다** —
 * 함수가 있는 것과 동작하는 것은 다르다. ADMIN_EMAIL로 가입해도 계속
 * 일반 개발자였던 이유다.
 *
 * **로그인할 때마다** 부른다: 가입 시점에만 하면 이미 만든 계정은 영영
 * 승격되지 않고, 나중에 ADMIN_EMAIL을 바꿔도 반영되지 않는다.
 * 승격 실패가 로그인을 막지는 않는다 — 들어가서 문의라도 할 수 있어야 한다.
 */
async function healAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return;

    const admin = createAdminClient();

    // [BL-016] **프로필을 먼저.** `ensureAdminRole`은 update라서 행이 없으면
    // 0행을 고치고 조용히 지나간다 — 프로필 없는 계정은 승격도 함께 실패한다.
    // 가입 트리거가 어떤 이유로든 걸렀을 때 여기서 스스로 낫는다.
    await ensureProfile(admin, user.id, user.email);

    await ensureAdminRole(admin, user.id, user.email, process.env.ADMIN_EMAIL);
  } catch {
    // 조용히 넘긴다 — 사용자가 원한 것은 로그인이다.
  }
}

/**
 * [P8-12] 관리자 화면에서의 로그아웃.
 *
 * 평범한 `logoutAction`은 `/login`으로 보낸다 — 계정을 갈아타려던 관리자는
 * 거기서 관리자 주소를 다시 잃는다. 여기서는 제자리로 돌려보낸다.
 */
export async function adminLogoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
