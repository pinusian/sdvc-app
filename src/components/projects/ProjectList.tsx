"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Project } from "@/lib/projects/store";

/**
 * [P4-4] 대시보드의 내 프로젝트 목록.
 *
 * 삭제(FR-022)는 파일까지 함께 지우고 되돌릴 수 없으므로, 실수로 누르지
 * 않도록 같은 자리에서 한 번 더 확인을 받는다(브라우저 기본 경고창 대신).
 */

type ListItem = Pick<Project, "id" | "name" | "slug" | "status" | "visibility">;

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  building: "만드는 중",
  deployed: "완성",
  failed: "실패",
};

const VISIBILITY_LABEL: Record<string, string> = {
  private: "비공개",
  link: "링크 공개",
  public: "전체 공개",
};

export function ProjectList({ projects }: { projects: ListItem[] }) {
  const [items, setItems] = useState(projects);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const data = (await res.json()) as { deleted?: boolean; error?: string };
      if (!res.ok || !data.deleted) throw new Error(data.error ?? "삭제하지 못했습니다.");
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-ink-muted">아직 만든 프로젝트가 없어요.</p>
        <p className="text-sm text-ink-faint">
          &ldquo;새 프로젝트&rdquo;를 눌러 SDVC와 대화하며 첫 프로젝트를 만들어보세요.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {items.map((project) => (
        <Card key={project.id} className="flex flex-wrap items-center justify-between gap-4 !p-5">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-ink">{project.name}</h2>
              <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                {STATUS_LABEL[project.status] ?? project.status}
              </span>
              <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                {VISIBILITY_LABEL[project.visibility] ?? project.visibility}
              </span>
            </div>
            <p className="font-mono text-xs text-ink-faint">/site/{project.slug}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {project.status === "deployed" && (
              <a
                href={`/site/${project.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-sm border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent-ink"
              >
                열어보기 ↗
              </a>
            )}

            {confirming === project.id ? (
              <>
                <span className="text-xs text-ink-muted">정말 지울까요? 되돌릴 수 없어요.</span>
                <Button
                  variant="accent"
                  className="!px-3 !py-1.5 text-xs"
                  disabled={busy === project.id}
                  onClick={() => void remove(project.id)}
                >
                  {busy === project.id ? "지우는 중…" : "네, 지울게요"}
                </Button>
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => setConfirming(null)}
                >
                  아니요
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                className="!px-3 !py-1.5 text-xs"
                onClick={() => setConfirming(project.id)}
              >
                삭제
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
