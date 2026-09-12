"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { GRADE_LIMITS, type Grade, type SubscriptionStatus } from "@/lib/billing/access";
import { formatTokens } from "@/lib/billing/plans";

/**
 * [P6-8] 대시보드의 "내 이용 상태".
 *
 * 막히고 나서야 알게 되면 늦다 — 남은 체험 기간과 이번 달 사용량을 미리
 * 보여준다. 여기 보이는 한도는 [P6-3]의 실제 판정 값과 같은 출처를 쓴다.
 */

const GRADE_LABEL: Record<Grade, string> = { trial: "체험", basic: "기본", pro: "프로" };
const DAY = 24 * 60 * 60 * 1000;

interface Props {
  grade: Grade;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  monthlyTokensUsed: number;
  projectCount: number;
  /** Stripe 고객 id가 있어 포털을 열 수 있는가 */
  canManage: boolean;
  now?: Date;
  redirectTo?: (url: string) => void;
}

export function AccountStatus({
  grade,
  subscriptionStatus,
  trialEndsAt,
  monthlyTokensUsed,
  projectCount,
  canManage,
  now = new Date(),
  redirectTo = (url) => {
    window.location.href = url;
  },
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limits = GRADE_LIMITS[grade] ?? GRADE_LIMITS.trial;
  const percent = Math.min(
    100,
    Math.round((monthlyTokensUsed / limits.monthlyTokens) * 100),
  );
  const nearLimit = percent >= 80;

  async function openPortal() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? "구독 관리 화면을 열지 못했습니다.");
      }
      redirectTo(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "구독 관리 화면을 열지 못했습니다.");
      setPending(false);
    }
  }

  return (
    /* [P7-1c] 부차 정보이므로 글자·세로를 기존의 70%로 줄인다 (FR-033).
       가로 폭은 목록과 같게 둔다 — 줄이면 화면이 들쭉날쭉해진다. */
    <section className="mt-6 rounded-lg border border-border bg-surface px-5 py-2.5 text-[10px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-0.5 text-[10px] font-medium text-ink">
            {statusLine(grade, subscriptionStatus, trialEndsAt, now)}
          </p>
          <p className="text-[10px] text-ink-muted">
            {`이번 달 ${formatTokens(monthlyTokensUsed)} / ${formatTokens(limits.monthlyTokens)} 토큰`}
            {" · "}
            {`프로젝트 ${projectCount} / ${limits.projects}개`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {subscriptionStatus !== "active" && (
            <a
              href="/pricing"
              className="inline-flex items-center rounded-sm bg-accent px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-accent-hover"
            >
              요금제 보기
            </a>
          )}
          {canManage && (
            <Button
              variant="secondary"
              className="!px-2.5 !py-1 text-[10px]"
              disabled={pending}
              onClick={() => void openPortal()}
            >
              {pending ? "여는 중…" : "구독 관리"}
            </Button>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="이번 달 사용량"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-1 w-full overflow-hidden rounded-pill bg-surface-muted"
      >
        <div
          className={`h-full rounded-pill ${nearLimit ? "bg-red-600" : "bg-accent"}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[10px] text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

/** 지금 상태를 한 줄로. 등급 이름만 보여주면 "언제까지"를 알 수 없다. */
function statusLine(
  grade: Grade,
  status: SubscriptionStatus,
  trialEndsAt: string | null,
  now: Date,
): string {
  if (status === "active" || status === "trialing") {
    return `${GRADE_LABEL[grade] ?? grade} 구독 중`;
  }
  if (status === "past_due") {
    return "결제가 밀려 있어요. 구독 관리에서 결제 정보를 확인해주세요.";
  }
  if (status === "canceled") {
    return "구독이 해지되었습니다. 다시 구독하면 이어서 쓸 수 있어요.";
  }

  // 아직 결제 전 — 체험 기간을 본다.
  if (!trialEndsAt) return "체험 기간 정보를 확인할 수 없습니다.";
  const left = new Date(trialEndsAt).getTime() - now.getTime();
  if (left <= 0) return "체험 기간이 끝났습니다. 계속 쓰시려면 요금제를 골라주세요.";
  // 가입 직후 남은 시간은 7일 경계에 딱 걸린다(DB 시계와 서버 시계가 몇 초
  // 어긋난다). 올림하면 "8일", 내림하면 "6일"로 보였다 — 둘 다 실제로 겪었다.
  // 반올림이 사람이 읽는 값과 맞고, 하루가 안 남으면 날짜 대신 말로 알린다.
  if (left < DAY) return "체험 오늘까지";
  return `체험 ${Math.round(left / DAY)}일 남음`;
}
