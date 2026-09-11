"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PLANS } from "@/lib/billing/plans";
import type { Grade, SubscriptionStatus } from "@/lib/billing/access";

/**
 * [P6-8] 요금제 고르기 (FR-028).
 *
 * 카드정보는 여기서 받지 않는다 — 결제하기를 누르면 서버가 Stripe 결제창을
 * 만들어 주소를 주고, 그리로 보낸다. 우리 화면은 카드번호를 보지 않는다.
 *
 * 이동을 prop으로 받는 이유: 테스트에서 실제 페이지 이동 없이 확인하기 위해서다.
 */

const GRADE_ORDER: Grade[] = ["trial", "basic", "pro"];

interface Props {
  currentGrade: Grade;
  subscriptionStatus: SubscriptionStatus;
  redirectTo?: (url: string) => void;
}

export function PricingPlans({
  currentGrade,
  subscriptionStatus,
  redirectTo = (url) => {
    window.location.href = url;
  },
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentIndex = GRADE_ORDER.indexOf(currentGrade);

  async function startCheckout(plan: "basic" | "pro") {
    if (pending) return;
    setPending(plan);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? "결제를 시작하지 못했습니다. 잠시 뒤 다시 시도해주세요.");
      }
      redirectTo(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제를 시작하지 못했습니다.");
      setPending(null);
    }
  }

  return (
    <div>
      <div className="grid gap-5 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.grade === currentGrade;
          const buyable =
            plan.planId !== undefined && GRADE_ORDER.indexOf(plan.grade) > currentIndex;

          return (
            <div
              key={plan.grade}
              className={`flex flex-col rounded-lg border bg-surface p-6 ${
                isCurrent ? "border-accent" : "border-border"
              }`}
            >
              <h3 className="mb-1 font-serif text-lg font-semibold text-ink">{plan.title}</h3>
              <p className="mb-4 text-sm text-ink-muted">{plan.summary}</p>

              <p className="mb-5">
                <span className="text-2xl font-semibold text-ink">{plan.price}</span>
                <span className="text-sm text-ink-muted"> / {plan.period}</span>
              </p>

              <ul className="mb-6 flex-1 space-y-1.5 text-sm text-ink">
                {plan.features.map((feature) => (
                  <li key={feature}>· {feature}</li>
                ))}
              </ul>

              {isCurrent ? (
                <p className="rounded-sm bg-accent-soft px-3 py-2 text-center text-sm font-medium text-accent-ink">
                  이용 중
                </p>
              ) : buyable ? (
                <Button
                  variant={plan.grade === "basic" ? "accent" : "primary"}
                  disabled={pending !== null}
                  onClick={() => void startCheckout(plan.planId!)}
                >
                  {pending === plan.planId
                    ? "준비 중…"
                    : buyLabel(plan.title, currentGrade, subscriptionStatus)}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="mt-6 text-xs text-ink-faint">
        결제는 Stripe가 처리하며, 카드정보는 SDVC 서버에 저장되지 않습니다. 언제든 해지할 수
        있고, 해지해도 만든 홈페이지는 30일 동안 보관됩니다.
      </p>
    </div>
  );
}

/** "기본" + 으로 / "프로" + 로 — 받침에 따라 조사를 맞춘다. */
function withParticle(title: string): string {
  const last = title.charCodeAt(title.length - 1);
  const hasFinalConsonant = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${title}${hasFinalConsonant ? "으로" : "로"}`;
}

function buyLabel(title: string, currentGrade: Grade, status: SubscriptionStatus): string {
  const subject = withParticle(title);
  if (status === "canceled") return `${subject} 다시 시작`;
  if (currentGrade === "trial") return `${subject} 시작`;
  return `${subject} 올리기`;
}
