"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { DocumentWorkflowView } from "@/lib/sdvc/document-state";

type ApprovalKind = "plan" | "tasks";

const LABELS: Record<ApprovalKind, string> = {
  plan: "계획",
  tasks: "작업 목록",
};

interface Props {
  kind: ApprovalKind;
  view: DocumentWorkflowView;
  busy: boolean;
  onApprove: (versionId: string) => void | Promise<void>;
  onContinue?: () => void | Promise<void>;
  onRevise?: () => void;
}

export function DocumentPanel({ kind, view, busy, onApprove, onContinue, onRevise }: Props) {
  const document = view.documents.find((item) => item.kind === kind);
  const latest = document?.versions[0] ?? null;
  const [selectedId, setSelectedId] = useState(latest?.id ?? "");
  const effectiveSelectedId = document?.versions.some((version) => version.id === selectedId)
    ? selectedId
    : (latest?.id ?? "");

  const selected = useMemo(
    () => document?.versions.find((version) => version.id === effectiveSelectedId) ?? latest,
    [document?.versions, effectiveSelectedId, latest],
  );

  if (!document || !latest || !selected) return null;

  const label = LABELS[kind];
  const latestSelected = selected.id === latest.id;
  const approved = document.approvedVersionId === latest.id;

  return (
    <section className="rounded-lg border border-accent bg-accent-soft px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-accent-ink">{label} 문서</p>
          <p className="text-xs text-ink-muted">저장된 버전을 확인한 뒤 최신 버전을 승인해주세요.</p>
        </div>
        <label className="text-xs text-ink-muted">
          <span className="mr-2">{label} 버전</span>
          <select
            aria-label={`${label} 버전`}
            value={effectiveSelectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            className="rounded-sm border border-border bg-surface px-2 py-1 text-ink"
          >
            {document.versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.version}
              </option>
            ))}
          </select>
        </label>
      </div>

      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-surface p-3 font-sans text-sm leading-relaxed text-ink">
        {selected.content}
      </pre>

      <div className="mt-3 flex flex-wrap gap-2">
        {approved ? (
          <Button variant="accent" disabled={busy} onClick={() => void onContinue?.()}>
            {busy ? "진행 중…" : "승인 완료 · 다음 단계로"}
          </Button>
        ) : (
          <Button
            variant="accent"
            disabled={busy || !latestSelected}
            onClick={() => void onApprove(latest.id)}
          >
            {busy
              ? "승인 중…"
              : latestSelected
                ? `${label} v${latest.version} 승인`
                : "최신 버전만 승인할 수 있습니다"}
          </Button>
        )}
        {onRevise && (
          <Button variant="secondary" disabled={busy} onClick={onRevise}>
            수정할 게 있어요
          </Button>
        )}
      </div>
    </section>
  );
}
