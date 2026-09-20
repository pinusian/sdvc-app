import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountRestrictionNotice } from "@/components/auth/AccountRestrictionNotice";
import { loadLearnerProfile } from "@/lib/auth/learner-profile";

export default async function AccountRestrictedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // secret key 조회지만 로그인한 본인의 id만 사용한다. URL이나 폼에서 대상 id를
  // 받지 않으므로 다른 수강생의 차단 사유를 조회할 수 없다.
  const profile = await loadLearnerProfile(user.id);

  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "developer" && profile.isActive && !profile.suspendedAt) {
    redirect("/dashboard");
  }

  const kind = !profile || profile.role !== "developer"
    ? "unavailable"
    : profile.suspendedAt
      ? "suspended"
      : "inactive";

  return (
    <AccountRestrictionNotice
      kind={kind}
      reason={kind === "suspended" ? profile?.suspendedReason : null}
    />
  );
}
