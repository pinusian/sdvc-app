import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * 서버(Server Component·Route Handler)에서 쓰는 Supabase 클라이언트.
 * Next.js 16부터 cookies()가 Promise를 반환하므로 반드시 await 한다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서 호출된 경우 — 세션 갱신은 미들웨어가 담당하므로 무시해도 된다.
          }
        },
      },
    },
  );
}

/**
 * 서버 전용 관리자 클라이언트(SUPABASE_SECRET_KEY 사용).
 * RLS(행 수준 보안)를 우회하므로 Route Handler 안에서만, 신중하게 사용한다.
 * 절대 브라우저로 전달되는 코드 경로에서 import 하지 않는다.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
