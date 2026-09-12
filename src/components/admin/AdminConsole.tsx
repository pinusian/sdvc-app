"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { EconomicsSummary } from "@/lib/admin/economics";
import type { DeveloperRow } from "@/lib/admin/developers";

/**
 * [P8-2][P8-3] 운영 화면 (FR-014·015, SC-006·007).
 *
 * 한 화면에서 두 가지가 보여야 한다: **지금 적자인가**, **누구를 손봐야 하는가**.
 * 그래프는 없다 — 데이터가 쌓이면 그때 붙인다(Clarify 21).
 */

interface Props {
  summary: EconomicsSummary;
  developers: DeveloperRow[];
}

const GRADE_LABEL: Record<string, string> = { trial: "체험", basic: "기본", pro: "프로" };
const STATUS_LABEL: Record<string, string> = {
  none: "미결제",
  active: "구독 중",
  past_due: "미납",
  canceled: "해지",
  trialing: "구독 중",
};

const money = (usd: number) => `$${usd.toFixed(2).replace(/\.00$/, "")}`;
const percent = (ratio: number | null) =>
  ratio === null ? "—" : `${Math.round(ratio * 100)}%`;

export function AdminConsole({ summary, developers }: Props) {
  const [rows, setRows] = useState(developers);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 정지하려는 대상과 사유 — 사유 없이는 정지할 수 없다 */
  const [suspending, setSuspending] = useState<{ id: string; reason: string } | null>(null);

  const inTheRed = summary.costRatio !== null && summary.costRatio >= 1;

  async function act(
    userId: string,
    action: "suspend" | "unsuspend" | "extend_trial",
    reason?: string,
  ) {
    setBusy(userId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/developers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, action, ...(reason ? { reason } : {}) }),
      });
      const data = (await res.json()) as {
        suspended?: boolean;
        trialEndsAt?: string;
        auditWarning?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "처리하지 못했습니다.");

      if (action === "extend_trial" && data.trialEndsAt) {
        setRows((prev) =>
          prev.map((row) =>
            row.id === userId ? { ...row, trialEndsAt: data.trialEndsAt! } : row,
          ),
        );
        setNotice(
          `체험을 ${new Date(data.trialEndsAt).toLocaleDateString("ko-KR")}까지로 늘렸습니다.`,
        );
      } else {
        const suspended = action === "suspend";
        setRows((prev) =>
          prev.map((row) =>
            row.id === userId
              ? {
                  ...row,
                  suspendedAt: suspended ? new Date().toISOString() : null,
                  suspendedReason: suspended ? (reason ?? null) : null,
                }
              : row,
          ),
        );
        setNotice(suspended ? "정지했습니다." : "정지를 풀었습니다.");
      }

      // 감사 로그 실패는 **조용히 넘기지 않는다** — 기록 없는 운영은 위험하다.
      if (data.auditWarning) setError(data.auditWarning);
      setSuspending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section
        className={`rounded-lg border p-5 ${
          inTheRed ? "border-red-600 bg-red-50" : "border-border bg-surface"
        }`}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">이번 달 수지</h2>
          {inTheRed && (
            <span className="rounded-pill bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              적자 — 팔수록 손해입니다
            </span>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-muted">API 원가</dt>
            <dd className="text-lg font-semibold text-ink">{money(summary.totalCostUsd)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">구독 매출</dt>
            <dd className="text-lg font-semibold text-ink">{money(summary.totalRevenueUsd)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">마진</dt>
            <dd
              className={`text-lg font-semibold ${
                summary.marginUsd < 0 ? "text-red-700" : "text-ink"
              }`}
            >
              {money(summary.marginUsd)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">요금 대비 원가</dt>
            <dd className="text-lg font-semibold text-ink">{percent(summary.costRatio)}</dd>
          </div>
        </dl>

        {summary.byDeveloper.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1.5 text-xs text-ink-muted">원가가 큰 순서</p>
            <ul className="space-y-1 text-sm">
              {summary.byDeveloper.slice(0, 5).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink">{row.email}</span>
                  <span className="text-ink-muted">{money(row.costUsd)}</span>
                  <span
                    className={
                      row.costRatio !== null && row.costRatio >= 1
                        ? "font-semibold text-red-700"
                        : "text-ink-faint"
                    }
                  >
                    {percent(row.costRatio)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">
          {notice}
        </p>
      )}

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3 text-base font-semibold text-ink">
          개발자 {rows.length}명
        </h2>

        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{row.email}</p>
                <p className="text-xs text-ink-muted">
                  {GRADE_LABEL[row.grade] ?? row.grade} ·{" "}
                  {STATUS_LABEL[row.subscriptionStatus] ?? row.subscriptionStatus}
                  {row.trialEndsAt &&
                    ` · 체험 ~${new Date(row.trialEndsAt).toLocaleDateString("ko-KR")}`}
                  {` · 가입 ${new Date(row.createdAt).toLocaleDateString("ko-KR")}`}
                </p>
                {row.suspendedAt && (
                  <p className="mt-0.5 text-xs font-medium text-red-700">
                    정지됨{row.suspendedReason ? ` — ${row.suspendedReason}` : ""}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  className="!px-2.5 !py-1 text-xs"
                  disabled={busy === row.id}
                  aria-label={`${row.email} 체험 연장`}
                  onClick={() => void act(row.id, "extend_trial")}
                >
                  체험 연장
                </Button>

                {row.suspendedAt ? (
                  <Button
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    disabled={busy === row.id}
                    aria-label={`${row.email} 정지 해제`}
                    onClick={() => void act(row.id, "unsuspend")}
                  >
                    정지 해제
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    disabled={busy === row.id}
                    aria-label={`${row.email} 정지`}
                    onClick={() => setSuspending({ id: row.id, reason: "" })}
                  >
                    정지
                  </Button>
                )}
              </div>

              {/* 사유 없이는 정지할 수 없다 — 나중에 왜 정지했는지 알아야 한다 */}
              {suspending?.id === row.id && (
                <form
                  className="flex w-full flex-wrap items-center gap-2 rounded-sm bg-surface-muted p-2.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(row.id, "suspend", suspending.reason.trim());
                  }}
                >
                  <label className="text-xs text-ink-muted" htmlFor={`reason-${row.id}`}>
                    정지 사유
                  </label>
                  <input
                    id={`reason-${row.id}`}
                    value={suspending.reason}
                    autoFocus
                    placeholder="예: 약관 위반 신고 접수"
                    onChange={(event) =>
                      setSuspending({ id: row.id, reason: event.target.value })
                    }
                    className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                  <Button
                    type="submit"
                    variant="accent"
                    className="!px-2.5 !py-1 text-xs"
                    disabled={!suspending.reason.trim() || busy === row.id}
                  >
                    정지합니다
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    onClick={() => setSuspending(null)}
                  >
                    취소
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
