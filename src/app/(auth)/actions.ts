"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { signUpDeveloper } from "@/lib/auth/signup";
import { loginDeveloper } from "@/lib/auth/login";
import { ensureAdminRole } from "@/lib/auth/admin";
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

  await promoteIfAdmin(supabase);

  redirect("/dashboard");
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

  await promoteIfAdmin(supabase);

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
 * [BL-008] 서버관리자 자동 승격 (FR-024).
 *
 * `ensureAdminRole`은 [P2-7]에서 만들었지만 **어디에서도 부르지 않았다** —
 * 함수가 있는 것과 동작하는 것은 다르다. ADMIN_EMAIL로 가입해도 계속
 * 일반 개발자였던 이유다.
 *
 * **로그인할 때마다** 부른다: 가입 시점에만 하면 이미 만든 계정은 영영
 * 승격되지 않고, 나중에 ADMIN_EMAIL을 바꿔도 반영되지 않는다.
 * 승격 실패가 로그인을 막지는 않는다 — 들어가서 문의라도 할 수 있어야 한다.
 */
async function promoteIfAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return;

    await ensureAdminRole(createAdminClient(), user.id, user.email, process.env.ADMIN_EMAIL);
  } catch {
    // 조용히 넘긴다 — 사용자가 원한 것은 로그인이다.
  }
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
