"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  MAX_BODY,
  MIN_BODY,
  REPORT_CATEGORIES,
  categoryLabel,
  statusLabel,
  validateReport,
  type ReportCategory,
} from "@/lib/reports/policy";
import { formatSeoulDateTime } from "@/lib/time/seoul";

/**
 * [P8-5e] 신고 창구 (FR-013·042·044).
 *
 * 보내는 곳과 **결과를 보는 곳을 한 화면에 둔다.** 결과를 따로 찾아가야 하면
 * 아무도 안 보고, 그러면 "받아만 두고 아무도 안 보는" 채널이 된다 —
 * Clarify 17에서 이 기능을 미뤄둔 바로 그 이유다.
 *
 * 보내기 전 판정은 API와 **같은 함수**(`validateReport`)로 한다. 화면에서만
 * 막으면 주소창으로 지나가고, API에서만 막으면 다 쓰고 나서야 거절당한다.
 */

export interface MyReport {
  id: string;
  category: string;
  body: string;
  targetUrl: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  handledAt: string | null;
}

const STATUS_TONE: Record<string, string> = {
  open: "bg-surface-muted text-ink-muted",
  in_progress: "bg-accent-soft text-accent-ink",
  resolved: "bg-accent-soft text-accent-ink",
  rejected: "bg-danger-soft text-danger",
};

export function ReportForm({ initial, canSubmit, blockReason }: {
  initial: MyReport[];
  canSubmit: boolean;
  blockReason: string | null;
}) {
  const [category, setCategory] = useState<ReportCategory>("bug");
  const [body, setBody] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const checked = validateReport({ category, body, targetUrl: targetUrl || null });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checked.value),
      });
      const data = (await res.json()) as { error?: string; report?: MyReport };
      if (!res.ok) throw new Error(data.error ?? "보내지 못했습니다.");

      if (data.report) setRows((prev) => [data.report as MyReport, ...prev]);
      setBody("");
      setTargetUrl("");
      setNotice("신고를 접수했습니다. 처리되면 아래에 결과가 표시됩니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <h2 className="mb-1 text-base font-semibold">문제 신고</h2>
        <p className="mb-5 text-sm text-ink-muted">
          서비스 오류나 다른 사람의 부적절한 산출물을 알려주세요. 처리 결과는 아래에 표시됩니다.
        </p>

        {!canSubmit && blockReason && (
          <p className="mb-4 rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {blockReason}
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">무엇에 대한 신고인가요</span>
            <select
              value={category}
              disabled={!canSubmit}
              onChange={(event) => setCategory(event.target.value as ReportCategory)}
              className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-60"
            >
              {REPORT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">무슨 일이 있었나요</span>
            <textarea
              value={body}
              rows={5}
              disabled={!canSubmit}
              placeholder={`${MIN_BODY}자 이상 적어주세요. 언제, 무엇을 하다가 그랬는지 적어주시면 빨리 찾습니다.`}
              onChange={(event) => setBody(event.target.value)}
              className="resize-y rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-60"
            />
            <span className="text-xs text-ink-faint">
              {body.trim().length} / {MAX_BODY}자
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">
              어디서 그랬나요 <span className="font-normal text-ink-muted">(없으면 비워두세요)</span>
            </span>
            <input
              value={targetUrl}
              disabled={!canSubmit}
              placeholder="https://sdvc-app.vercel.app/site/..."
              onChange={(event) => setTargetUrl(event.target.value)}
              className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </label>

          {error && (
            <p className="rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-sm bg-accent-soft px-3.5 py-2.5 text-sm text-accent-ink">
              {notice}
            </p>
          )}

          <Button type="submit" variant="accent" disabled={!canSubmit || sending} className="self-start">
            {sending ? "보내는 중…" : "신고 보내기"}
          </Button>
        </form>
      </Card>

      <section>
        <h2 className="mb-3 text-base font-semibold">내가 보낸 신고</h2>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-ink-muted">
            아직 보낸 신고가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((report) => (
              <li key={report.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-pill px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_TONE[report.status] ?? "bg-surface-muted text-ink-muted"
                    }`}
                  >
                    {statusLabel(report.status)}
                  </span>
                  <span className="text-xs text-ink-muted">{categoryLabel(report.category)}</span>
                  <span className="text-xs text-ink-faint">
                    {formatSeoulDateTime(report.createdAt)}
                  </span>
                </div>

                <p className="whitespace-pre-wrap text-sm text-ink">{report.body}</p>

                {report.targetUrl && (
                  <p className="mt-1 break-all text-xs text-ink-faint">{report.targetUrl}</p>
                )}

                {/* 결과를 보려고 오는 화면이다 — 답이 있으면 가장 눈에 띄게 */}
                {report.adminNote && (
                  <div className="mt-3 rounded-sm border-l-2 border-accent bg-surface-muted px-3.5 py-2.5">
                    <p className="mb-0.5 text-xs font-medium text-accent-ink">운영자 답변</p>
                    <p className="whitespace-pre-wrap text-sm text-ink">{report.adminNote}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
