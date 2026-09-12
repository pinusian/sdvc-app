"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { EconomicsSummary } from "@/lib/admin/economics";
import type { DeveloperRow } from "@/lib/admin/developers";
import { formatTokens } from "@/lib/billing/plans";
import { endOfDaySeoul, formatSeoulDate } from "@/lib/time/seoul";

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
  /** [P8-2c] 등급을 부여하려는 대상 (FR-035) */
  const [granting, setGranting] = useState<{
    id: string;
    grade: "basic" | "pro";
    until: string;
    reason: string;
  } | null>(null);
  /** [P8-2c] 한도를 고치려는 대상 (FR-036) */
  const [limiting, setLimiting] = useState<{ id: string; value: string } | null>(null);

  const inTheRed = summary.costRatio !== null && summary.costRatio >= 1;

  /**
   * 관리 API 호출 하나 — 오류·감사 경고 처리를 한곳에 모은다.
   * 부여·한도·정지가 각자 처리하면 감사 경고를 빠뜨리는 곳이 생긴다.
   */
  async function send(
    userId: string,
    body: Record<string, unknown>,
    onOk: (data: Record<string, unknown>) => string,
  ) {
    setBusy(userId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/developers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? "처리하지 못했습니다.");
      setNotice(onOk(data));
      if (data.auditWarning) setError(data.auditWarning as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  /** [P8-2c] 등급 부여·해제 (FR-035) */
  async function grant(
    userId: string,
    input: { grade: "basic" | "pro"; until: string; reason: string } | null,
  ) {
    const body: Record<string, unknown> = input
      ? {
          userId,
          action: "grant_grade",
          grade: input.grade,
          // 날짜만 고르므로 **한국 시각 그날이 끝날 때까지**로 본다.
          // UTC로 해석하면 만료가 9시간 늦어진다 — 그것이 BL-012였다.
          ...(endOfDaySeoul(input.until) ? { until: endOfDaySeoul(input.until) } : {}),
          ...(input.reason.trim() ? { reason: input.reason.trim() } : {}),
        }
      : { userId, action: "grant_grade" };

    await send(userId, body, () => {
      setRows((prev) =>
        prev.map((row) =>
          row.id === userId
            ? {
                ...row,
                grantedGrade: input ? input.grade : null,
                grantedUntil: input ? endOfDaySeoul(input.until) : null,
                grantedReason: input && input.reason.trim() ? input.reason.trim() : null,
              }
            : row,
        ),
      );
      setGranting(null);
      return input ? "등급을 부여했습니다." : "부여를 해제했습니다.";
    });
  }

  /** [P8-2c] 계정별 한도 (FR-036). 빈칸이면 null — 등급 기본값으로 되돌린다. */
  async function saveLimit(userId: string, raw: string) {
    const trimmed = raw.trim();
    const limit = trimmed === "" ? null : Number(trimmed);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
      setError("월 한도는 0 이상의 정수여야 합니다.");
      return;
    }

    await send(userId, { userId, action: "set_limit", limit }, () => {
      setRows((prev) =>
        prev.map((row) => (row.id === userId ? { ...row, monthlyTokenLimit: limit } : row)),
      );
      setLimiting(null);
      return limit === null
        ? "한도를 등급 기본값으로 되돌렸습니다."
        : "한도를 " + limit.toLocaleString("ko-KR") + " 토큰으로 정했습니다.";
    });
  }

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
          `체험을 ${formatSeoulDate(data.trialEndsAt)}까지로 늘렸습니다.`,
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
                    ` · 체험 ~${formatSeoulDate(row.trialEndsAt)}`}
                  {` · 가입 ${formatSeoulDate(row.createdAt)}`}
                </p>
                {row.suspendedAt && (
                  <p className="mt-0.5 text-xs font-medium text-red-700">
                    정지됨{row.suspendedReason ? ` — ${row.suspendedReason}` : ""}
                  </p>
                )}
                {/* [P8-2c] 부여받은 등급·계정 한도는 결제분과 구별해 보여준다 */}
                {(row.grantedGrade || row.monthlyTokenLimit != null) && (
                  <p className="mt-0.5 text-xs text-accent-ink">
                    {row.grantedGrade &&
                      `부여: ${GRADE_LABEL[row.grantedGrade] ?? row.grantedGrade}` +
                        (row.grantedUntil
                          ? ` (~${formatSeoulDate(row.grantedUntil)})`
                          : " (무기한)") +
                        (row.grantedReason ? ` · ${row.grantedReason}` : "")}
                    {row.grantedGrade && row.monthlyTokenLimit != null && " · "}
                    {row.monthlyTokenLimit != null &&
                      `한도 ${formatTokens(row.monthlyTokenLimit)} 토큰`}
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

                {row.grantedGrade ? (
                  <Button
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    disabled={busy === row.id}
                    aria-label={`${row.email} 부여 해제`}
                    onClick={() => void grant(row.id, null)}
                  >
                    부여 해제
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    disabled={busy === row.id}
                    aria-label={`${row.email} 등급 부여`}
                    onClick={() =>
                      setGranting({ id: row.id, grade: "basic", until: "", reason: "" })
                    }
                  >
                    등급 부여
                  </Button>
                )}

                <Button
                  variant="secondary"
                  className="!px-2.5 !py-1 text-xs"
                  disabled={busy === row.id}
                  aria-label={`${row.email} 한도`}
                  onClick={() =>
                    setLimiting({
                      id: row.id,
                      value: row.monthlyTokenLimit != null ? String(row.monthlyTokenLimit) : "",
                    })
                  }
                >
                  한도
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

              {/* [P8-2c] 등급 부여 (FR-035) */}
              {granting?.id === row.id && (
                <form
                  className="flex w-full flex-wrap items-center gap-2 rounded-sm bg-surface-muted p-2.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void grant(row.id, granting);
                  }}
                >
                  <label className="text-xs text-ink-muted" htmlFor={`grade-${row.id}`}>
                    부여할 등급
                  </label>
                  <select
                    id={`grade-${row.id}`}
                    value={granting.grade}
                    onChange={(event) =>
                      setGranting({ ...granting, grade: event.target.value as "basic" | "pro" })
                    }
                    className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  >
                    <option value="basic">기본</option>
                    <option value="pro">프로</option>
                  </select>

                  <label className="text-xs text-ink-muted" htmlFor={`until-${row.id}`}>
                    언제까지
                  </label>
                  <input
                    id={`until-${row.id}`}
                    type="date"
                    value={granting.until}
                    onChange={(event) => setGranting({ ...granting, until: event.target.value })}
                    className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  />

                  <input
                    value={granting.reason}
                    placeholder="사유 (예: 가을 강의 수강생)"
                    onChange={(event) => setGranting({ ...granting, reason: event.target.value })}
                    className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  />

                  <Button
                    type="submit"
                    variant="accent"
                    className="!px-2.5 !py-1 text-xs"
                    disabled={busy === row.id}
                  >
                    부여합니다
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    onClick={() => setGranting(null)}
                  >
                    취소
                  </Button>
                </form>
              )}

              {/* [P8-2c] 계정별 한도 (FR-036). 비우면 등급 기본값, 0은 완전 차단 */}
              {limiting?.id === row.id && (
                <form
                  className="flex w-full flex-wrap items-center gap-2 rounded-sm bg-surface-muted p-2.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveLimit(row.id, limiting.value);
                  }}
                >
                  <label className="text-xs text-ink-muted" htmlFor={`limit-${row.id}`}>
                    월 토큰 한도
                  </label>
                  <input
                    id={`limit-${row.id}`}
                    value={limiting.value}
                    inputMode="numeric"
                    placeholder="비우면 등급 기본값 · 0은 완전 차단"
                    onChange={(event) => setLimiting({ id: row.id, value: event.target.value })}
                    className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                  <Button
                    type="submit"
                    variant="accent"
                    className="!px-2.5 !py-1 text-xs"
                    disabled={busy === row.id}
                  >
                    한도 저장
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="!px-2.5 !py-1 text-xs"
                    onClick={() => setLimiting(null)}
                  >
                    취소
                  </Button>
                </form>
              )}

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
