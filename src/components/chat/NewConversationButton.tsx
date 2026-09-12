"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MAX_NAME_LENGTH } from "@/lib/projects/name";

/**
 * [P3-5] 새 대화를 만들고 그 화면으로 들어간다.
 *
 * [P7-1b] 시작할 때 이름을 정할 수 있다 (FR-030). **비워도 시작된다** —
 * 무엇을 만들지 아직 모르는 사람에게 이름부터 물으면 그게 첫 관문이 된다.
 * 비워두면 첫 요청 문장을 보고 지어준다.
 */
export function NewConversationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const title = name.trim();
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(title ? { title } : {}),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "대화를 시작하지 못했습니다.");
      router.push(`/conversations/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "대화를 시작하지 못했습니다.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="text-right">
        <Button variant="accent" onClick={() => setOpen(true)}>
          + 새 프로젝트
        </Button>
      </div>
    );
  }

  return (
    <form
      className="w-full max-w-[320px] rounded-lg border border-border bg-surface p-4 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <label className="mb-1 block text-sm font-medium text-ink" htmlFor="new-project-name">
        프로젝트 이름
      </label>
      <input
        id="new-project-name"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        autoFocus
        placeholder="예: 우리 빵집 홈페이지"
        onChange={(event) => setName(event.target.value)}
        className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
      />
      <p className="mt-1.5 text-xs text-ink-faint">
        비워두면 첫 대화 내용을 보고 지어드려요. 나중에 언제든 바꿀 수 있습니다.
      </p>

      <div className="mt-3 flex gap-2">
        <Button type="submit" variant="accent" className="!px-3 !py-1.5 text-xs" disabled={busy}>
          {busy ? "여는 중…" : "시작하기"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="!px-3 !py-1.5 text-xs"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setName("");
            setError(null);
          }}
        >
          취소
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
