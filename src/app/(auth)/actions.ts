"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signUpDeveloper } from "@/lib/auth/signup";
import { loginDeveloper } from "@/lib/auth/login";

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

  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
