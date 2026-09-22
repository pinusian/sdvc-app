"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type {
  PersistentRun,
  PersistentRunEvent,
  PersistentRunStatus,
} from "@/lib/execution/persistent-runs";

const LAST_RUN_KEY = "sdvc:last-run-id";
const TERMINAL: PersistentRunStatus[] = ["cancelled", "succeeded", "failed"];

interface RunView {
  run: PersistentRun;
  events: PersistentRunEvent[];
}

export function RunProgressPanel({
  projects,
}: {
  projects: Array<{ id: string; name: string }>;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [view, setView] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const loadRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    const payload = await response.json() as RunView & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "실행 상태를 읽지 못했습니다.");
    if (mounted.current) setView(payload);
    return payload;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const runId = localStorage.getItem(LAST_RUN_KEY);
    if (runId) loadRun(runId).catch((reason: unknown) => {
      if (mounted.current) setError(toMessage(reason));
    });
    return () => { mounted.current = false; };
  }, [loadRun]);

  useEffect(() => {
    if (!view || TERMINAL.includes(view.run.status)) return;
    const timer = window.setInterval(() => {
      loadRun(view.run.id).catch((reason: unknown) => setError(toMessage(reason)));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [loadRun, view]);

  async function createRun() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json() as { run?: PersistentRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "실행을 만들지 못했습니다.");
      localStorage.setItem(LAST_RUN_KEY, payload.run.id);
      setView({ run: payload.run, events: [] });
      await loadRun(payload.run.id);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun() {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${view.run.id}`, { method: "DELETE" });
      const payload = await response.json() as { run?: PersistentRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "취소하지 못했습니다.");
      setView((current) => current ? { ...current, run: payload.run! } : current);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function retryRun() {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${view.run.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json() as { run?: PersistentRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "재시도하지 못했습니다.");
      localStorage.setItem(LAST_RUN_KEY, payload.run.id);
      setView({ run: payload.run, events: [] });
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">구현 진행</h2>
          <p className="mt-1 text-sm text-ink-muted">승인된 계획과 작업을 기준으로 진행 상태를 보관합니다.</p>
        </div>
        {view && <span className="rounded-pill bg-accent-soft px-3 py-1 text-sm font-medium text-accent-ink">{statusLabel(view.run.status)}</span>}
      </div>

      {!view && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-sm">
            <span className="mb-1 block font-medium">프로젝트</span>
            <select
              aria-label="실행할 프로젝트"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2.5"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <Button type="button" onClick={createRun} disabled={busy || !projectId}>구현 실행 준비</Button>
        </div>
      )}

      {view && (
        <>
          <ol aria-label="실행 로그" className="mt-4 space-y-2">
            {view.events.length === 0 && <li className="text-sm text-ink-muted">아직 기록된 로그가 없습니다.</li>}
            {view.events.map((event) => (
              <li key={event.id} className="rounded-sm border border-border px-3 py-2 text-sm">
                <span className="mr-2 text-ink-muted">#{event.sequence}</span>
                {eventLabel(event)}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex gap-2">
            {(view.run.status === "queued" || view.run.status === "running") && (
              <Button type="button" variant="secondary" onClick={cancelRun} disabled={busy}>실행 취소</Button>
            )}
            {(view.run.status === "failed" || view.run.status === "cancelled") && (
              <Button type="button" onClick={retryRun} disabled={busy}>다시 시도</Button>
            )}
          </div>
        </>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    </Card>
  );
}

function statusLabel(status: PersistentRunStatus) {
  return ({
    queued: "대기 중",
    running: "실행 중",
    cancel_requested: "취소 요청됨",
    cancelled: "취소됨",
    succeeded: "완료",
    failed: "실패",
  } satisfies Record<PersistentRunStatus, string>)[status];
}

function eventLabel(event: PersistentRunEvent) {
  if (typeof event.payload.message === "string") return event.payload.message;
  const labels: Record<string, string> = {
    red_started: "RED 테스트 시작",
    red_verified: "RED 실패 확인",
    green_started: "GREEN 테스트 시작",
    green_passed: "GREEN 통과",
    run_succeeded: "실행 완료",
    run_failed: "실행 실패",
    cancellation_requested: "취소 요청",
  };
  return labels[event.type] ?? event.type;
}

function toMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다.";
}
