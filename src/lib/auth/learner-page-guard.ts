import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";

/**
 * 보호 Server Component의 공통 입구.
 *
 * 레이아웃은 부분 렌더링 때문에 탐색마다 다시 검사된다는 보장이 없으므로,
 * 실제 데이터를 읽는 페이지에서 호출한다. API와 같은 최신 프로필 판정을 쓰되
 * 화면 요청은 로그인 또는 계정 제한 안내 화면으로 보낸다.
 */
export async function requireLearnerPageAccess(): Promise<User> {
  const access = await requireLearnerAccess();
  if (access.ok) return access.user;

  if (access.response.status === 401) {
    redirect("/login");
  }

  redirect("/account-restricted");
}
