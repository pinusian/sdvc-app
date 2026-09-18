"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Project, Visibility } from "@/lib/projects/store";
import { MAX_NAME_LENGTH } from "@/lib/projects/name";

/**
 * [P4-4] 대시보드의 내 프로젝트 목록.
 *
 * 삭제(FR-022)는 파일까지 함께 지우고 되돌릴 수 없으므로, 실수로 누르지
 * 않도록 같은 자리에서 한 번 더 확인을 받는다(브라우저 기본 경고창 대신).
 */

/** [P7-6d] 되돌릴 수 있는 시점 하나 */
interface VersionChoice {
  name: string;
  at: string | null;
  request: string;
}

/** [P11-6] 개발자 관리 화면에 보이는 방문자 한 명 */
interface SiteUserItem {
  id: string;
  email: string;
  displayName: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

/** [P11-6] 그 방문자가 남긴 기록 한 건 */
interface SiteRecordItem {
  id: string;
  title: string;
  author: string | null;
  note: string | null;
}

type ListItem = Pick<
  Project,
  "id" | "name" | "slug" | "status" | "visibility" | "siteLoginEnabled"
> & {
  /** [P5-4b] 이 프로젝트를 만든 대화. 있으면 "이어서 수정"으로 들어간다 */
  conversationId?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  building: "만드는 중",
  deployed: "완성",
  failed: "실패",
};

/** 초보자가 고를 수 있게 "무슨 뜻인지"로 적는다. */
const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "private", label: "비공개 — 나만 봅니다" },
  { value: "link", label: "링크를 아는 사람만 봅니다" },
  { value: "public", label: "누구나 봅니다 (검색에도 노출)" },
];

export function ProjectList({ projects }: { projects: ListItem[] }) {
  const [items, setItems] = useState(projects);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** [P7-1b] 지금 이름을 고치고 있는 프로젝트와 입력값 */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  /** [P7-6d] 되돌리기 패널 — 어느 프로젝트의 버전 목록을 펼쳤는가 */
  const [rollback, setRollback] = useState<{
    id: string;
    versions: VersionChoice[] | null;
    confirming: string | null;
  } | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  /** [P11-6] 방문자 관리 패널 — 어느 프로젝트의 방문자 목록을 펼쳤는가 */
  const [siteUsers, setSiteUsers] = useState<{ projectId: string; users: SiteUserItem[] | null } | null>(
    null,
  );
  /** 지금 정지 사유를 입력받는 중인 방문자 */
  const [suspending, setSuspending] = useState<{ siteUserId: string; reason: string } | null>(null);
  /** 지금 기록을 펼쳐 보고 있는 방문자 */
  const [viewingRecords, setViewingRecords] = useState<{
    siteUserId: string;
    records: SiteRecordItem[] | null;
  } | null>(null);
  const [siteUserBusy, setSiteUserBusy] = useState<string | null>(null);

  /**
   * [P5-3] 공개범위 변경 (FR-007).
   * 화면을 먼저 바꿔 보여주고(반응이 빨라야 하므로), 실패하면 되돌린다 —
   * 실제로는 비공개인데 공개된 것처럼 보이면 안 되기 때문이다.
   */
  async function changeVisibility(id: string, next: Visibility) {
    const previous = items.find((item) => item.id === id)?.visibility;
    setError(null);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, visibility: next } : item)),
    );

    try {
      const res = await fetch(`/api/projects/${id}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      const data = (await res.json()) as { visibility?: string; error?: string };
      if (!res.ok || !data.visibility) throw new Error(data.error ?? "바꾸지 못했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "바꾸지 못했습니다.");
      if (previous) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, visibility: previous } : item)),
        );
      }
    }
  }

  /**
   * [P11-7] 방문자 로그인 켜기/끄기. 공개범위와 같은 방식으로 먼저 화면을
   * 바꾸고 실패하면 되돌린다 — 꺼졌다고 표시됐는데 실제로는 켜져 있으면
   * 개발자가 안심하고 있다가 방문자가 계속 로그인할 수 있는 상태가 된다.
   */
  async function toggleSiteLogin(id: string, next: boolean) {
    const previous = items.find((item) => item.id === id)?.siteLoginEnabled;
    setError(null);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, siteLoginEnabled: next } : item)),
    );

    try {
      const res = await fetch(`/api/projects/${id}/site-login`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json()) as { enabled?: boolean; error?: string };
      if (!res.ok || data.enabled === undefined) throw new Error(data.error ?? "바꾸지 못했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "바꾸지 못했습니다.");
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, siteLoginEnabled: previous ?? true } : item)),
      );
    }
  }

  async function copyAddress(slug: string) {
    const address = `${window.location.origin}/site/${slug}`;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(slug);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(`주소를 복사하지 못했습니다. 직접 복사해주세요: ${address}`);
    }
  }

  /**
   * [P7-1b] 이름 바꾸기 (FR-030).
   * 공개범위와 같은 방식 — 화면을 먼저 바꾸고 실패하면 되돌린다.
   */
  async function saveName(id: string, next: string) {
    const name = next.trim();
    if (!name) return;
    const previous = items.find((item) => item.id === id)?.name;

    setError(null);
    setRenaming(null);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, name } : item)));

    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { name?: string; error?: string };
      if (!res.ok || !data.name) throw new Error(data.error ?? "이름을 바꾸지 못했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "이름을 바꾸지 못했습니다.");
      if (previous !== undefined) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, name: previous } : item)),
        );
      }
    }
  }

  /** [P7-6d] 보관된 버전 목록을 불러온다 (FR-012). */
  async function openRollback(id: string) {
    setError(null);
    setRestored(null);
    setRollback({ id, versions: null, confirming: null });
    try {
      const res = await fetch(`/api/projects/${id}/rollback`);
      const data = (await res.json()) as { versions?: VersionChoice[]; error?: string };
      if (!res.ok || !data.versions) throw new Error(data.error ?? "버전을 불러오지 못했습니다.");
      setRollback({ id, versions: data.versions, confirming: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "버전을 불러오지 못했습니다.");
      setRollback(null);
    }
  }

  /** 되돌리기는 지금 화면을 통째로 바꾼다 — 한 번 더 확인받은 뒤에만 부른다. */
  async function doRollback(id: string, version: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = (await res.json()) as {
        fileCount?: number;
        removedCount?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "되돌리지 못했습니다.");
      setRestored(
        `그 시점으로 되돌렸습니다 (파일 ${data.fileCount ?? 0}개` +
          (data.removedCount ? `, 그 뒤에 생긴 파일 ${data.removedCount}개 정리` : "") +
          ")",
      );
      setRollback(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "되돌리지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  /** [P11-6] 방문자 목록을 불러온다. */
  async function openSiteUsers(id: string) {
    setError(null);
    setViewingRecords(null);
    setSuspending(null);
    setSiteUsers({ projectId: id, users: null });
    try {
      const res = await fetch(`/api/projects/${id}/site-users`);
      const data = (await res.json()) as { users?: SiteUserItem[]; error?: string };
      if (!res.ok || !data.users) throw new Error(data.error ?? "방문자 목록을 불러오지 못했습니다.");
      setSiteUsers({ projectId: id, users: data.users });
    } catch (e) {
      setError(e instanceof Error ? e.message : "방문자 목록을 불러오지 못했습니다.");
      setSiteUsers(null);
    }
  }

  /** 정지·정지 해제 — 화면은 성공한 뒤에만 바꾼다(삭제와 달리 되돌릴 수 있는 조작이라 낙관적으로 먼저 바꾸지 않아도 된다). */
  async function toggleSuspend(projectId: string, siteUserId: string, suspend: boolean, reason?: string) {
    setSiteUserBusy(siteUserId);
    setError(null);
    try {
      const path = suspend ? "suspend" : "unsuspend";
      const res = await fetch(`/api/projects/${projectId}/site-users/${siteUserId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: suspend ? JSON.stringify({ reason }) : undefined,
      });
      const data = (await res.json()) as { suspended?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "처리하지 못했습니다.");

      setSiteUsers((prev) =>
        prev && prev.projectId === projectId
          ? {
              ...prev,
              users: (prev.users ?? []).map((item) =>
                item.id === siteUserId
                  ? {
                      ...item,
                      suspendedAt: suspend ? new Date().toISOString() : null,
                      suspendedReason: suspend ? (reason ?? null) : null,
                    }
                  : item,
              ),
            }
          : prev,
      );
      setSuspending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setSiteUserBusy(null);
    }
  }

  /** 이 방문자가 남긴 기록을 펼쳐 본다. */
  async function openRecords(projectId: string, siteUserId: string) {
    setError(null);
    setViewingRecords({ siteUserId, records: null });
    try {
      const res = await fetch(`/api/projects/${projectId}/site-users/${siteUserId}/records`);
      const data = (await res.json()) as { records?: SiteRecordItem[]; error?: string };
      if (!res.ok || !data.records) throw new Error(data.error ?? "기록을 불러오지 못했습니다.");
      setViewingRecords({ siteUserId, records: data.records });
    } catch (e) {
      setError(e instanceof Error ? e.message : "기록을 불러오지 못했습니다.");
      setViewingRecords(null);
    }
  }

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

      {restored && (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">
          {restored}
        </p>
      )}

      {items.map((project) => (
        <Card key={project.id} className="flex flex-wrap items-center justify-between gap-4 !p-5">
          <div className="min-w-0">
            {renaming?.id === project.id ? (
              <form
                className="mb-2 flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveName(project.id, renaming.value);
                }}
              >
                <label className="sr-only" htmlFor={`rename-${project.id}`}>
                  프로젝트 이름
                </label>
                <input
                  id={`rename-${project.id}`}
                  value={renaming.value}
                  maxLength={MAX_NAME_LENGTH}
                  autoFocus
                  onChange={(event) => setRenaming({ id: project.id, value: event.target.value })}
                  className="rounded-sm border border-border bg-surface px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
                />
                <Button
                  type="submit"
                  variant="accent"
                  className="!px-2.5 !py-1 text-xs"
                  disabled={!renaming.value.trim()}
                >
                  저장
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!px-2.5 !py-1 text-xs"
                  onClick={() => setRenaming(null)}
                >
                  취소
                </Button>
              </form>
            ) : (
              <div className="mb-1 flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-ink">{project.name}</h2>
                <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                  {STATUS_LABEL[project.status] ?? project.status}
                </span>
                <button
                  type="button"
                  onClick={() => setRenaming({ id: project.id, value: project.name })}
                  className="shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-ink-faint hover:text-accent-ink"
                >
                  이름 바꾸기
                </button>
              </div>
            )}
            <p className="mb-2 font-mono text-xs text-ink-faint">/site/{project.slug}</p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-ink-muted">
                <span className="sr-only">공개범위</span>
                <select
                  aria-label="공개범위"
                  value={project.visibility}
                  onChange={(event) =>
                    void changeVisibility(project.id, event.target.value as Visibility)
                  }
                  className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                >
                  {VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {project.visibility !== "private" && (
                <button
                  type="button"
                  onClick={() => void copyAddress(project.slug)}
                  className="rounded-sm border border-border px-2 py-1 text-xs text-ink-muted hover:border-accent hover:text-accent-ink"
                >
                  {copied === project.slug ? "복사됐어요" : "주소 복사"}
                </button>
              )}

              {/* [P11-7] 방문자 로그인 켜기/끄기 — 꺼져 있어도 이미 가입한 계정·기록은
                  그대로 남고, 다시 켜면 돌아온다(지우는 것이 아니라 문만 잠근다) */}
              {project.status === "deployed" && (
                <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={project.siteLoginEnabled ?? true}
                    onChange={(event) => void toggleSiteLogin(project.id, event.target.checked)}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  방문자 로그인
                </label>
              )}
            </div>
          </div>

          {/* [P7-6d] 되돌리기 패널 (FR-012) */}
          {rollback?.id === project.id && (
            <div className="w-full rounded-lg border border-border bg-surface-muted p-3">
              {rollback.versions === null ? (
                <p className="text-xs text-ink-muted">불러오는 중…</p>
              ) : rollback.versions.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  되돌릴 수 있는 시점이 없어요. 한 번 고치고 나면 생깁니다.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {rollback.versions.map((version) => (
                    <li key={version.name} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-ink-muted">
                        {version.at ? new Date(version.at).toLocaleString("ko-KR") : "시각 모름"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {version.request || "(설명 없음)"}
                      </span>
                      {rollback.confirming === version.name ? (
                        <span className="flex items-center gap-1.5">
                          <Button
                            variant="accent"
                            className="!px-2.5 !py-1 text-xs"
                            disabled={busy === project.id}
                            onClick={() => void doRollback(project.id, version.name)}
                          >
                            네, 되돌립니다
                          </Button>
                          <Button
                            variant="secondary"
                            className="!px-2.5 !py-1 text-xs"
                            onClick={() =>
                              setRollback({ ...rollback, confirming: null })
                            }
                          >
                            아니요
                          </Button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`${version.request || version.name} 시점으로 되돌리기`}
                          onClick={() => setRollback({ ...rollback, confirming: version.name })}
                          className="rounded-sm border border-border px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent-ink"
                        >
                          이 시점으로
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setRollback(null)}
                className="mt-2 text-xs text-ink-faint hover:text-ink"
              >
                닫기
              </button>
            </div>
          )}

          {/* [P11-6] 방문자 관리 패널 — 사용자 목록·기록 열람·정지 */}
          {siteUsers?.projectId === project.id && (
            <div className="w-full rounded-lg border border-border bg-surface-muted p-3">
              {siteUsers.users === null ? (
                <p className="text-xs text-ink-muted">불러오는 중…</p>
              ) : siteUsers.users.length === 0 ? (
                <p className="text-xs text-ink-muted">아직 가입한 방문자가 없어요.</p>
              ) : (
                <ul className="space-y-2">
                  {siteUsers.users.map((siteUser) => (
                    <li key={siteUser.id} className="rounded-sm border border-border bg-surface p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">
                          {siteUser.displayName ? `${siteUser.displayName} · ` : ""}
                          {siteUser.email}
                        </span>
                        {siteUser.suspendedAt ? (
                          <span className="rounded-pill bg-red-100 px-2 py-0.5 text-xs text-red-700">
                            정지됨{siteUser.suspendedReason ? ` — ${siteUser.suspendedReason}` : ""}
                          </span>
                        ) : (
                          <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                            이용 중
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            viewingRecords?.siteUserId === siteUser.id
                              ? setViewingRecords(null)
                              : void openRecords(project.id, siteUser.id)
                          }
                          className="rounded-sm border border-border px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent-ink"
                        >
                          {viewingRecords?.siteUserId === siteUser.id ? "기록 닫기" : "기록 보기"}
                        </button>

                        {siteUser.suspendedAt ? (
                          <Button
                            variant="secondary"
                            className="!px-2.5 !py-1 text-xs"
                            disabled={siteUserBusy === siteUser.id}
                            onClick={() => void toggleSuspend(project.id, siteUser.id, false)}
                          >
                            정지 해제
                          </Button>
                        ) : suspending?.siteUserId === siteUser.id ? (
                          <span className="flex w-full items-center gap-1.5">
                            <label className="sr-only" htmlFor={`suspend-reason-${siteUser.id}`}>
                              정지 사유
                            </label>
                            <input
                              id={`suspend-reason-${siteUser.id}`}
                              autoFocus
                              placeholder="정지 사유 (예: 도배성 기록 작성)"
                              value={suspending.reason}
                              onChange={(event) =>
                                setSuspending({ siteUserId: siteUser.id, reason: event.target.value })
                              }
                              className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                            />
                            <Button
                              variant="accent"
                              className="!px-2.5 !py-1 text-xs"
                              disabled={!suspending.reason.trim() || siteUserBusy === siteUser.id}
                              onClick={() =>
                                void toggleSuspend(project.id, siteUser.id, true, suspending.reason)
                              }
                            >
                              정지
                            </Button>
                            <Button
                              variant="secondary"
                              className="!px-2.5 !py-1 text-xs"
                              onClick={() => setSuspending(null)}
                            >
                              취소
                            </Button>
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            className="!px-2.5 !py-1 text-xs"
                            onClick={() => setSuspending({ siteUserId: siteUser.id, reason: "" })}
                          >
                            정지
                          </Button>
                        )}
                      </div>

                      {viewingRecords?.siteUserId === siteUser.id && (
                        <div className="mt-2 border-t border-border pt-2">
                          {viewingRecords.records === null ? (
                            <p className="text-xs text-ink-muted">불러오는 중…</p>
                          ) : viewingRecords.records.length === 0 ? (
                            <p className="text-xs text-ink-muted">아직 남긴 기록이 없어요.</p>
                          ) : (
                            <ul className="space-y-1">
                              {viewingRecords.records.map((record) => (
                                <li key={record.id} className="text-xs text-ink-muted">
                                  <span className="text-ink">{record.title}</span>
                                  {record.author ? ` · ${record.author}` : ""}
                                  {record.note ? ` — ${record.note}` : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => {
                  setSiteUsers(null);
                  setViewingRecords(null);
                  setSuspending(null);
                }}
                className="mt-2 text-xs text-ink-faint hover:text-ink"
              >
                닫기
              </button>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-2">
            {/* [P5-4b] 버그 수정·기능 추가는 그 프로젝트를 만든 대화에서 이어서 한다 (FR-025) */}
            {project.conversationId && (
              <a
                href={`/conversations/${project.conversationId}`}
                className="inline-flex items-center rounded-sm border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent-ink"
              >
                이어서 수정
              </a>
            )}

            {/* [P7-6d] 되돌리기는 완성된 프로젝트에만 있다 (FR-012) */}
            {project.status === "deployed" && (
              <button
                type="button"
                onClick={() => void openRollback(project.id)}
                className="inline-flex items-center rounded-sm border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent-ink"
              >
                되돌리기
              </button>
            )}

            {/* [P11-6] 방문자 계정을 쓰는 프로젝트에만 뜻이 있지만, 로그인을 꺼둔 프로젝트도
                이미 가입한 방문자가 있을 수 있어 배포된 프로젝트 전체에 보여준다 */}
            {project.status === "deployed" && (
              <button
                type="button"
                onClick={() => void openSiteUsers(project.id)}
                className="inline-flex items-center rounded-sm border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent-ink"
              >
                방문자 관리
              </button>
            )}

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
