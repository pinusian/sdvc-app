"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

interface CredentialStatus {
  configured: boolean;
  maskedKey: string | null;
  keyVersion: string | null;
  updatedAt: string | null;
}

const EMPTY_STATUS: CredentialStatus = {
  configured: false,
  maskedKey: null,
  keyVersion: null,
  updatedAt: null,
};

async function readJson(response: Response) {
  return (await response.json().catch(() => null)) as
    | (Partial<CredentialStatus> & { error?: string })
    | null;
}

export function OpenAIKeySettings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/settings/openai-key", { cache: "no-store" });
        const body = await readJson(response);
        if (!response.ok) throw new Error(body?.error ?? "키 상태를 확인하지 못했습니다.");
        if (active) setStatus({ ...EMPTY_STATUS, ...body });
      } catch (cause) {
        if (active) {
          setStatus(EMPTY_STATUS);
          setError(cause instanceof Error ? cause.message : "키 상태를 확인하지 못했습니다.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function saveKey() {
    if (pending || !apiKey.trim()) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/openai-key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body?.error ?? "OpenAI API 키를 저장하지 못했습니다.");
      setStatus({ ...EMPTY_STATUS, ...body });
      setApiKey("");
      setNotice(status?.configured ? "OpenAI API 키를 교체했습니다." : "OpenAI API 키를 등록했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OpenAI API 키를 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function deleteKey() {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/openai-key", { method: "DELETE" });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body?.error ?? "OpenAI API 키를 삭제하지 못했습니다.");
      setStatus(EMPTY_STATUS);
      setConfirmingDelete(false);
      setNotice("OpenAI API 키를 삭제했습니다. 새 AI 작업은 키를 다시 등록할 때까지 시작되지 않습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OpenAI API 키를 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mt-6 !p-5">
      <section aria-labelledby="openai-key-heading">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="openai-key-heading" className="text-lg">AI 연결 설정</h2>
            <p className="mt-1 text-sm text-ink-muted">
              내 OpenAI API 키로 SDVC의 AI 기능을 사용합니다.
            </p>
          </div>
          <p className="rounded-pill bg-surface-muted px-3 py-1 text-xs font-medium text-ink-muted">
            {status === null
              ? "확인 중…"
              : status.configured
                ? status.maskedKey
                : "등록된 키가 없습니다"}
          </p>
        </div>

        <div className="rounded-md border border-border bg-surface-muted px-4 py-3 text-xs leading-5 text-ink-muted">
          <p>OpenAI API 사용료는 등록한 키의 OpenAI 계정에 직접 청구되며 SDVC 이용료와 별도입니다.</p>
          <p>키 원문은 저장 후 다시 표시되지 않습니다. 교체하려면 새 키를 입력하세요.</p>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field
              label="OpenAI API 키"
              name="openaiApiKey"
              type="password"
              autoComplete="new-password"
              placeholder="sk-…"
              value={apiKey}
              disabled={pending || status === null}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="accent"
            disabled={pending || status === null || !apiKey.trim()}
            onClick={() => void saveKey()}
          >
            {pending ? "처리 중…" : status?.configured ? "키 교체" : "키 등록"}
          </Button>
          {status?.configured && !confirmingDelete && (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              키 삭제
            </Button>
          )}
        </div>

        {confirmingDelete && (
          <div className="mt-4 rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            <p>키를 삭제하면 진행 중인 AI 작업도 중단되고 새 작업을 시작할 수 없습니다.</p>
            <div className="mt-3 flex gap-2">
              <Button type="button" disabled={pending} onClick={() => void deleteKey()}>
                삭제 확인
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirmingDelete(false)}
              >
                취소
              </Button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-accent-ink">{notice}</p>}
      </section>
    </Card>
  );
}
