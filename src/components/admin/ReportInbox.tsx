"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  REPORT_STATUSES,
  categoryLabel,
  statusLabel,
  type ReportStatus,
} from "@/lib/reports/policy";
import { formatSeoulDateTime } from "@/lib/time/seoul";

/**
 * [P8-5e] 접수함 (FR-043·044, FR-016).
 *
 * 운영자가 한 화면에서 끝내야 하는 일: **읽고 · 답하고 · 필요하면 가린다.**
 * 가리기가 여기 없으면 부적절한 산출물 신고를 받고도 다른 화면을 찾아
 * 헤매게 되고, 급할 때 헤매는 화면은 없는 화면과 같다.
 *
 * 답(`adminNote`)은 **신고한 사람에게 그대로 보인다** — 내부 메모가 아니다.
 */

export interface InboxRow {
  id: string;
  reporterEmail: string | null;
  category: string;
  body: string;
  targetUrl: string | null;
  targetProjectId: string | null;
  /** 지목된 산출물이 지금 가려져 있는가 */
  targetBlocked: boolean;
  status: string;
  adminNote: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  open: "bg-danger-soft text-danger",
  in_progress: "bg-accent-soft text-accent-ink",
  resolved: "bg-surface-muted text-ink-muted",
  rejected: "bg-surface-muted text-ink-muted",
};

interface Draft {
  status: ReportStatus;
  note: string;
  block: boolean;
}

export function ReportInbox({
  reports,
  canHandle,
  canBlock,
}: {
  reports: InboxRow[];
  canHandle: boolean;
  canBlock: boolean;
}) {
  const [rows, setRows] = useState(reports);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startHandling(row: InboxRow) {
    setOpen(row.id);
    setDraft({
      status: (row.status as ReportStatus) ?? "open",
      note: row.adminNote ?? "",
      block: row.targetBlocked,
    });
    setError(null);
    setNotice(null);
  }

  async function save(row: InboxRow) {
    if (!draft) return;

    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      // 가리기 상태를 바꿀 때만 함께 보낸다 — 저장할 때마다 가리고 푸는 일이 없게.
      const blockChanged = row.targetProjectId && draft.block !== row.targetBlocked;

      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportId: row.id,
          status: draft.status,
          adminNote: draft.note,
          ...(blockChanged ? { blockProjectId: row.targetProjectId, blocked: draft.block } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; auditWarning?: string };
      if (!res.ok) throw new Error(data.error ?? "처리하지 못했습니다.");

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                status: draft.status,
                adminNote: draft.note.trim() ? draft.note.trim() : null,
                targetBlocked: r.targetProjectId ? draft.block : r.targetBlocked,
              }
            : r,
        ),
      );
      setOpen(null);
      setNotice("처리했습니다. 신고한 분에게 답이 보입니다.");
      if (data.auditWarning) setError(data.auditWarning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-ink-muted">
        조건에 맞는 신고가 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p className="rounded-sm bg-accent-soft px-3.5 py-2.5 text-sm text-accent-ink">{notice}</p>
      )}
      {error && (
        <p className="rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {rows.map((row) => (
        <article key={row.id} className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-pill px-2.5 py-0.5 text-xs font-medium ${
                STATUS_TONE[row.status] ?? "bg-surface-muted text-ink-muted"
              }`}
            >
              {statusLabel(row.status)}
            </span>
            <span className="text-xs font-medium text-ink">{categoryLabel(row.category)}</span>
            <span className="text-xs text-ink-muted">{row.reporterEmail ?? "탈퇴한 계정"}</span>
            <span className="text-xs text-ink-faint">{formatSeoulDateTime(row.createdAt)}</span>
            {row.targetBlocked && (
              <span className="rounded-pill bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                산출물 가려짐
              </span>
            )}
          </div>

          <p className="whitespace-pre-wrap text-sm text-ink">{row.body}</p>

          {row.targetUrl && (
            <p className="mt-1 break-all text-xs text-ink-faint">
              {row.targetUrl}
              {!row.targetProjectId && " (짚히는 프로젝트 없음)"}
            </p>
          )}

          {row.adminNote && open !== row.id && (
            <div className="mt-3 rounded-sm border-l-2 border-accent bg-surface-muted px-3.5 py-2.5">
              <p className="mb-0.5 text-xs font-medium text-accent-ink">보낸 답변</p>
              <p className="whitespace-pre-wrap text-sm text-ink">{row.adminNote}</p>
            </div>
          )}

          {canHandle && open !== row.id && (
            <Button
              variant="secondary"
              className="mt-3 !px-2.5 !py-1 text-xs"
              aria-label={`${row.id} 처리`}
              onClick={() => startHandling(row)}
            >
              처리하기
            </Button>
          )}

          {open === row.id && draft && (
            <form
              className="mt-3 flex flex-col gap-2.5 rounded-sm bg-surface-muted p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save(row);
              }}
            >
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                상태
                <select
                  aria-label="처리 상태"
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as ReportStatus })
                  }
                  className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                >
                  {REPORT_STATUSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                답변 <span className="text-ink-faint">(신고한 분에게 그대로 보입니다)</span>
                <textarea
                  aria-label="답변"
                  rows={3}
                  value={draft.note}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                  className="resize-y rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
                />
              </label>

              {/* [FR-016] 가리기 — 지우지 않는다. 오판했으면 되돌린다 */}
              {row.targetProjectId && canBlock && (
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={draft.block}
                    onChange={(event) => setDraft({ ...draft, block: event.target.checked })}
                  />
                  이 산출물을 가린다 (지우지 않고 접속만 막습니다)
                </label>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  variant="accent"
                  className="!px-2.5 !py-1 text-xs"
                  disabled={busy === row.id}
                >
                  {busy === row.id ? "처리 중…" : "저장"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!px-2.5 !py-1 text-xs"
                  onClick={() => setOpen(null)}
                >
                  취소
                </Button>
              </div>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}
