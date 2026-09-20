"use client";

import { useRef, useState } from "react";
import { SDVC_BLOCKS, resolveBlock, type BlockId } from "@/lib/sdvc/blocks";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/attachments/validate";
import type { ChatMessage } from "@/lib/claude/chat";
import type { DocumentWorkflowView } from "@/lib/sdvc/document-state";
import { Button } from "@/components/ui/Button";
import { DocumentPanel } from "@/components/chat/DocumentPanel";

/**
 * [P3-5] SDVC 대화 화면.
 *
 * 서버가 흘려보내는 NDJSON 이벤트를 한 줄씩 읽어 화면에 붙인다.
 * - text: 답변에 이어붙인다
 * - thinking: "생각하는 중" 표시 (모델이 확장 사고를 켰을 때 화면이 멈춘 것처럼
 *   보이지 않게 하려고 [P3-3]에서 추가한 이벤트)
 * - error: 그대로 알린다
 */

/** [P7-11] 올려둔 첨부 하나 — 서버가 돌려준 id로만 다시 가리킨다 */
interface Attachment {
  id: string;
  kind: "image" | "text";
  name: string;
}

interface Props {
  conversationId: string;
  currentBlock: BlockId;
  initialMessages: ChatMessage[];
  initialDocumentWorkflow?: DocumentWorkflowView | null;
}

export function ChatView({
  conversationId,
  currentBlock,
  initialMessages,
  initialDocumentWorkflow = null,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // [P7-4b] 예전에 done으로 굳은 대화도 유지보수로 읽어 다시 연다 (BL-001).
  const [block, setBlock] = useState<BlockId>(resolveBlock(currentBlock));
  /** [P3-6] 승인 대기 중인 게이트. null이면 대기 중이 아니다. */
  const [gate, setGate] = useState<BlockId | null>(null);
  /** [P4-4] 방금 만들어진 산출물 */
  const [artifact, setArtifact] = useState<{
    slug: string;
    fileCount: number;
    imageCount: number;
  } | null>(null);
  /** [P4-5] 답변이 최대 길이에 걸려 끊겼는가 */
  const [truncated, setTruncated] = useState(false);
  /** [P6-4] 체험 만료·한도 초과로 막혔는가 — 요금제로 가는 길을 함께 보여준다 */
  const [blocked, setBlocked] = useState(false);
  /** [P7-11] 지금 붙여둔 첨부 — 고르는 즉시 올려 id를 받아둔다 (FR-031) */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [documentWorkflow, setDocumentWorkflow] =
    useState<DocumentWorkflowView | null>(initialDocumentWorkflow);
  const [approvingDocument, setApprovingDocument] = useState(false);
  const [documentPanelOpen, setDocumentPanelOpen] = useState(
    initialDocumentWorkflow !== null && (currentBlock === "plan" || currentBlock === "tasks"),
  );
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const blockInfo = SDVC_BLOCKS.find((b) => b.id === resolveBlock(block));
  const approvalKind = block === "plan" || block === "tasks" ? block : null;

  async function refreshDocuments() {
    try {
      const response = await fetch(`/api/conversations/${conversationId}/documents`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as
        | (DocumentWorkflowView & { error?: string })
        | null;
      if (!response.ok || !data) {
        throw new Error(data?.error ?? "저장된 문서를 불러오지 못했습니다.");
      }
      setDocumentWorkflow(data);
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장된 문서를 불러오지 못했습니다.");
      return null;
    }
  }

  async function approveDocument(versionId: string) {
    if (!approvalKind || approvingDocument || streaming) return;
    setApprovingDocument(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: approvalKind, versionId }),
      });
      const data = (await response.json().catch(() => null)) as
        | (DocumentWorkflowView & { error?: string })
        | null;
      if (!response.ok || !data) {
        throw new Error(data?.error ?? "문서를 승인하지 못했습니다.");
      }
      setDocumentWorkflow(data);
      await send({ message: "예, 이대로 진행해주세요.", approved: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문서를 승인하지 못했습니다.");
    } finally {
      setApprovingDocument(false);
    }
  }

  /**
   * [P7-11] 고른 파일을 **바로** 올린다.
   * 보낼 때 한꺼번에 올리면 큰 파일에서 "보내기"가 멈춘 것처럼 보이고,
   * 형식이 틀렸다는 것도 그제야 알게 된다.
   */
  async function attach(files: FileList | null) {
    if (!files || files.length === 0 || uploading) return;

    const room = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    if (room <= 0) {
      setError(`한 번에 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지 붙일 수 있어요.`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("conversationId", conversationId);
      for (const file of Array.from(files).slice(0, room)) form.append("files", file);

      const res = await fetch("/api/attachments", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { attachments?: Attachment[]; error?: string }
        | null;

      if (!res.ok || !data?.attachments) {
        throw new Error(data?.error ?? "파일을 올리지 못했습니다.");
      }
      setAttachments((prev) => [...prev, ...data.attachments!]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 올리지 못했습니다.");
    } finally {
      setUploading(false);
      // 같은 파일을 다시 고를 수 있게 비운다.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send(options?: { message?: string; approved?: boolean }) {
    const message = (options?.message ?? draft).trim();
    if (!message || streaming) return;

    // 보낸 첨부는 화면에서 비운다 — 다음 메시지에 또 붙지 않게.
    const sending = options?.message ? [] : attachments;
    if (!options?.message) {
      setDraft("");
      setAttachments([]);
    }
    setError(null);
    setStreaming(true);
    setGate(null);
    setArtifact(null);
    setTruncated(false);
    setBlocked(false);
    setMessages((prev) => [...prev, { role: "user", content: message }]);

    // 답변이 시작됐는지. 시작된 뒤의 실패는 "중간에 끊긴 것"이라 되살리지 않는다.
    let startedAnswering = false;
    // [BL-022] 서버가 "저장까지 끝났다"고 알렸는지, 대신 오류를 알렸는지
    let completed = false;
    let sawError = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message,
          ...(options?.approved ? { approved: true } : {}),
          ...(sending.length > 0 ? { attachmentIds: sending.map((a) => a.id) } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as
          | { error?: string; reason?: string }
          | null;
        // 402는 "돈 문제로 막혔다"는 뜻 — 오류가 아니라 안내에 가깝다.
        if (res.status === 402) setBlocked(true);
        throw new Error(detail?.error ?? `요청에 실패했습니다. (상태 ${res.status})`);
      }

      await readEvents(res.body, {
        onText: (text) => {
          setThinking(false);
          startedAnswering = true;
          setMessages((prev) => appendToAssistant(prev, text));
          // scrollIntoView는 없는 환경(테스트 등)이 있으므로 있을 때만 부른다.
          endRef.current?.scrollIntoView?.({ behavior: "smooth" });
        },
        onThinking: () => setThinking(true),
        onError: (message) => {
          sawError = true;
          setError(message);
        },
        onDone: () => {
          completed = true;
        },
        onGate: (gateBlock) => {
          setGate(gateBlock);
          if (gateBlock === "plan" || gateBlock === "tasks") {
            setDocumentPanelOpen(true);
            void refreshDocuments();
          }
        },
        onBlock: (nextBlock) => {
          setBlock(nextBlock);
          setDocumentPanelOpen(false);
        },
        onArtifact: (published) => setArtifact(published),
        onTruncated: () => setTruncated(true),
      });

      // [BL-022] done 없이 닫혔으면 서버가 도중에 끊긴 것이다(시간 한도 등).
      // 예전에는 화면이 조용히 멈춰, 사용자가 영문도 모른 채 "다음 단계로"를 눌렀다.
      if (!completed && !sawError) {
        setError(
          "응답이 도중에 끊겼습니다. 이 답변은 저장되지 않았을 수 있습니다 — 같은 요청을 한 번 더 보내주세요.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");

      // [BL-021a] **쓴 글을 돌려준다.** 입력창은 보내기 직전에 이미 비워졌으므로,
      // 여기서 되살리지 않으면 5개 항목짜리 긴 요청이 통째로 사라진다(실제로 그랬다).
      // 답변이 한 글자라도 시작됐으면 그건 실패가 아니라 중간에 끊긴 것이므로
      // 대화에 남겨둔다 — 되살리는 것은 **시작도 못 한 요청**뿐이다.
      if (!startedAnswering) {
        setMessages((prev) => dropLastUserMessage(prev, message));
        if (!options?.message) {
          setDraft((current) => (current.trim() ? current : message));
          setAttachments(sending);
        }
      }
    } finally {
      setThinking(false);
      setStreaming(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-7 py-3 text-sm text-ink-muted">
        {blockInfo ? (
          <span>
            <span className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
              블록 {blockInfo.number} / {SDVC_BLOCKS.length}
            </span>{" "}
            {blockInfo.title}
          </span>
        ) : (
          // 여기 올 일은 없다(모든 블록이 목록에 있다). 남겨두되 막다른 말은 쓰지 않는다.
          <span>대화를 불러오는 중…</span>
        )}

        {/*
          [P4-6] 단계 이동 버튼은 늘 여기에 있다.
          모델이 승인 마커를 빠뜨리거나, 새로고침으로 게이트 안내가 사라져도
          사용자가 스스로 다음 단계로 갈 수 있어야 하기 때문이다.
          누르는 것 자체가 명시적 승인이므로 승인 게이트 원칙에 어긋나지 않는다.
        */}
        {blockInfo &&
          blockInfo.id !== "plan" &&
          blockInfo.id !== "tasks" &&
          blockInfo.id !== "implement" &&
          blockInfo.id !== "maintenance" && (
          <Button
            variant="secondary"
            className="!px-3 !py-1.5 text-xs"
            disabled={streaming}
            onClick={() => void send({ message: "예, 다음 단계로 진행해주세요.", approved: true })}
          >
            다음 단계로 →
          </Button>
        )}
      </div>

      <div className="mx-auto w-full max-w-[760px] flex-1 space-y-4 overflow-y-auto px-7 py-8">
        {messages.length === 0 && (
          <p className="text-center text-sm text-ink-faint">
            {blockInfo?.id === "maintenance"
              ? "고칠 곳이나 더하고 싶은 기능을 말씀해주세요. 예: “제목 글자를 더 크게”"
              : "무엇을 만들고 싶은지 편하게 말씀해주세요. 예: “홈페이지 만들고 싶어”"}
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-accent-soft text-accent-ink"
                  : "border border-border bg-surface text-ink"
              }`}
            >
              {textOf(message.content)}
            </div>
          </div>
        ))}

        {thinking && (
          <p className="text-sm text-ink-faint">생각하는 중…</p>
        )}
        {streaming && !thinking && block === "implement" && (
          <p className="text-sm text-ink-faint">홈페이지 파일을 만드는 중…</p>
        )}
        {streaming && !thinking && block === "maintenance" && (
          <p className="text-sm text-ink-faint">고치는 중…</p>
        )}

        {truncated && !streaming && (
          <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
            <p className="mb-2 text-sm text-ink-muted">
              답변이 길어서 중간에 끊겼습니다. 이어서 마저 받아야 파일이 저장됩니다.
            </p>
            <Button
              variant="secondary"
              className="!px-3 !py-1.5 text-xs"
              onClick={() => void send({ message: "이어서 계속해주세요." })}
            >
              이어서 계속
            </Button>
          </div>
        )}

        {artifact && (
          <div className="rounded-lg border border-accent bg-accent-soft px-4 py-3">
            <p className="mb-1 text-sm font-medium text-accent-ink">
              홈페이지가 만들어졌습니다 (파일 {artifact.fileCount}개
              {artifact.imageCount > 0 ? `, 사진 ${artifact.imageCount}장` : ""})
            </p>
            <p className="mb-3 font-mono text-xs text-accent-ink">/site/{artifact.slug}</p>
            <a
              href={`/site/${artifact.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              열어보기 ↗
            </a>
          </div>
        )}

        {approvalKind && documentWorkflow && documentPanelOpen && !streaming && (
          <DocumentPanel
            kind={approvalKind}
            view={documentWorkflow}
            busy={approvingDocument}
            onApprove={approveDocument}
            onContinue={() =>
              send({ message: "예, 이대로 진행해주세요.", approved: true })
            }
            onRevise={() => {
              setGate(null);
              setDocumentPanelOpen(false);
            }}
          />
        )}

        {gate && gate !== "plan" && gate !== "tasks" && !streaming && (
          <div className="rounded-lg border border-accent bg-accent-soft px-4 py-3">
            <p className="mb-3 text-sm text-accent-ink">
              {gateLabel(gate)} 단계를 마쳤습니다. 이대로 다음 단계로 넘어갈까요?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="accent"
                onClick={() => void send({ message: "예, 이대로 진행해주세요.", approved: true })}
              >
                예, 이대로 진행
              </Button>
              <Button variant="secondary" onClick={() => setGate(null)}>
                수정할 게 있어요
              </Button>
            </div>
          </div>
        )}
        {error && !blocked && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        {error && blocked && (
          <div role="alert" className="rounded-lg border border-accent bg-accent-soft px-4 py-3">
            <p className="mb-3 text-sm text-accent-ink">{error}</p>
            <a
              href="/pricing"
              className="inline-flex items-center rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              요금제 보기
            </a>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border bg-surface px-7 py-4">
        {/* [P7-11] 붙인 파일들. 고르는 즉시 올라가므로 여기 보이면 이미 준비된 것이다 */}
        {(attachments.length > 0 || uploading) && (
          <div className="mx-auto mb-2 w-full max-w-[760px]">
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-1 text-xs text-ink"
                >
                  <span aria-hidden>{file.kind === "image" ? "🖼" : "📄"}</span>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    aria-label={`${file.name} 떼기`}
                    onClick={() =>
                      setAttachments((prev) => prev.filter((a) => a.id !== file.id))
                    }
                    className="text-ink-faint hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              ))}
              {uploading && <span className="text-xs text-ink-faint">올리는 중…</span>}
            </div>
            {attachments.some((file) => file.kind === "image") && (
              <p className="mt-1 text-xs text-ink-faint">
                사진은 글보다 토큰을 많이 씁니다 — 이번 달 사용량이 빨리 줄어들 수 있어요.
              </p>
            )}
          </div>
        )}

        <form
          className="mx-auto flex w-full max-w-[760px] items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="flex-1 text-sm">
            <span className="sr-only">메시지</span>
            <textarea
              aria-label="메시지"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="메시지를 입력하세요 (Enter로 보내기, Shift+Enter로 줄바꿈)"
              className="w-full resize-none rounded-sm border border-border bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
          </label>
          <label
            className="inline-flex cursor-pointer items-center rounded-sm border border-border px-3 py-2.5 text-sm text-ink-muted hover:border-accent hover:text-accent-ink"
            title="사진이나 글파일을 붙입니다"
          >
            📎
            <span className="sr-only">파일 붙이기</span>
            <input
              ref={fileRef}
              type="file"
              aria-label="파일 붙이기"
              multiple
              accept=".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json"
              className="sr-only"
              disabled={uploading || streaming}
              onChange={(event) => void attach(event.target.files)}
            />
          </label>

          <Button type="submit" variant="accent" disabled={streaming}>
            {streaming ? "보내는 중…" : "보내기"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * 화면에 보일 글자만 꺼낸다.
 * [P7-9]에서 메시지 내용이 블록 배열일 수도 있게 됐다(첨부). 저장되는 것은
 * 여전히 글자뿐이지만, 타입이 넓어졌으므로 여기서 좁혀 받는다.
 */
function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : "[첨부한 이미지]"))
    .join("\n");
}

/** 마지막 assistant 메시지에 이어붙이고, 없으면 새로 만든다. */
function appendToAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return [...messages.slice(0, -1), { ...last, content: textOf(last.content) + text }];
  }
  return [...messages, { role: "assistant", content: text }];
}

/**
 * [BL-021a] 보내자마자 실패했을 때, 낙관적으로 붙여둔 사용자 말풍선을 거둔다.
 *
 * 입력창에 글을 되살리면서 말풍선도 남겨두면 같은 글이 화면에 두 번 보인다.
 * 맨 끝이 그 글일 때만 거둔다 — 그 사이에 다른 것이 들어왔다면 남의 것이다.
 */
function dropLastUserMessage(messages: ChatMessage[], content: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "user" && textOf(last.content) === content) return messages.slice(0, -1);
  return messages;
}

function gateLabel(block: BlockId): string {
  return SDVC_BLOCKS.find((b) => b.id === block)?.title.replace(" ★승인 게이트★", "") ?? "이번";
}

interface EventHandlers {
  onText: (text: string) => void;
  onDone: () => void;
  onThinking: () => void;
  onError: (message: string) => void;
  onGate: (block: BlockId) => void;
  onBlock: (block: BlockId) => void;
  onArtifact: (artifact: { slug: string; fileCount: number; imageCount: number }) => void;
  onTruncated: () => void;
}

/** NDJSON 스트림을 한 줄씩 읽어 이벤트로 넘긴다. */
async function readEvents(body: ReadableStream<Uint8Array>, handlers: EventHandlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: {
      type: string;
      text?: string;
      message?: string;
      block?: BlockId;
      slug?: string;
      fileCount?: number;
      imageCount?: number;
    };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "text" && event.text) handlers.onText(event.text);
    else if (event.type === "thinking") handlers.onThinking();
    else if (event.type === "gate" && event.block) handlers.onGate(event.block);
    else if (event.type === "block" && event.block) handlers.onBlock(event.block);
    else if (event.type === "artifact" && event.slug)
      handlers.onArtifact({
        slug: event.slug,
        fileCount: event.fileCount ?? 0,
        imageCount: event.imageCount ?? 0,
      });
    else if (event.type === "truncated") handlers.onTruncated();
    else if (event.type === "error") handlers.onError(event.message ?? "오류가 발생했습니다.");
    else if (event.type === "done") handlers.onDone();
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineAt: number;
    while ((newlineAt = buffer.indexOf("\n")) !== -1) {
      handleLine(buffer.slice(0, newlineAt));
      buffer = buffer.slice(newlineAt + 1);
    }
  }
  handleLine(buffer);
}
