"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** [P3-5] 새 대화를 만들고 그 화면으로 들어간다. */
export function NewConversationButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "대화를 시작하지 못했습니다.");
      router.push(`/conversations/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "대화를 시작하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button variant="accent" onClick={start} disabled={busy}>
        {busy ? "여는 중…" : "+ 새 프로젝트"}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
