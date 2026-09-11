import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PricingPlans } from "@/components/billing/PricingPlans";
import type { Grade, SubscriptionStatus } from "@/lib/billing/access";

/**
 * [P6-8] 요금제 화면 (FR-028).
 *
 * 로그인하지 않아도 볼 수 있다 — 얼마인지 알아야 가입할지 정할 수 있다.
 * 결제 자체는 로그인해야 하고, 그 판정은 서버(`/api/billing/checkout`)가 한다.
 */

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let grade: Grade = "trial";
  let subscriptionStatus: SubscriptionStatus = "none";

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("grade, subscription_status")
      .eq("id", user.id)
      .maybeSingle();
    const row = profile as { grade?: Grade; subscription_status?: SubscriptionStatus } | null;
    grade = row?.grade ?? "trial";
    subscriptionStatus = row?.subscription_status ?? "none";
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-7 py-4">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          SDVC
        </Link>
        <Link
          href={user ? "/dashboard" : "/login"}
          className="text-sm text-ink-muted hover:text-accent-ink"
        >
          {user ? "내 프로젝트로" : "로그인"}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[960px] flex-1 px-7 py-12">
        <div className="mb-10 text-center">
          <h1 className="mb-2">요금제</h1>
          <p className="text-sm text-ink-muted">
            말로 설명하면 홈페이지가 만들어집니다. 7일 동안 무료로 먼저 써보세요.
          </p>
        </div>

        {checkout === "cancelled" && (
          <p className="mb-6 rounded-lg border border-border bg-surface-muted px-4 py-3 text-center text-sm text-ink-muted">
            결제를 취소했습니다. 언제든 다시 고르실 수 있어요.
          </p>
        )}

        {!user && (
          <p className="mb-6 rounded-lg border border-accent bg-accent-soft px-4 py-3 text-center text-sm text-accent-ink">
            결제하려면 먼저{" "}
            <Link href="/login" className="font-semibold underline">
              로그인
            </Link>
            해주세요. 가입하면 7일 체험이 바로 시작됩니다.
          </p>
        )}

        <PricingPlans currentGrade={grade} subscriptionStatus={subscriptionStatus} />
      </main>
    </div>
  );
}
