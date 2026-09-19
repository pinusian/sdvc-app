import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { AccountRestrictionNotice } from "@/components/auth/AccountRestrictionNotice";

interface RestrictedProfile {
  role: string;
  is_active: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
}

export default async function AccountRestrictedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // secret key 조회지만 로그인한 본인의 id만 사용한다. URL이나 폼에서 대상 id를
  // 받지 않으므로 다른 수강생의 차단 사유를 조회할 수 없다.
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("role, is_active, suspended_at, suspended_reason")
    .eq("id", user.id)
    .maybeSingle();
  const profile = data as RestrictedProfile | null;

  if (!error && profile?.role === "admin") redirect("/admin");
  if (!error && profile?.role === "developer" && profile.is_active && !profile.suspended_at) {
    redirect("/dashboard");
  }

  const kind = error || !profile || profile.role !== "developer"
    ? "unavailable"
    : profile.suspended_at
      ? "suspended"
      : "inactive";

  return (
    <AccountRestrictionNotice
      kind={kind}
      reason={kind === "suspended" ? profile?.suspended_reason : null}
    />
  );
}
