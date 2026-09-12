"use client";

import { useRef, useState } from "react";
import { SDVC_BLOCKS, resolveBlock, type BlockId } from "@/lib/sdvc/blocks";
import type { ChatMessage } from "@/lib/claude/chat";
import { Button } from "@/components/ui/Button";

/**
 * [P3-5] SDVC 대화 화면.
 *
 * 서버가 흘려보내는 NDJSON 이벤트를 한 줄씩 읽어 화면에 붙인다.
 * - text: 답변에 이어붙인다
 * - thinking: "생각하는 중" 표시 (모델이 확장 사고를 켰을 때 화면이 멈춘 것처럼
 *   보이지 않게 하려고 [P3-3]에서 추가한 이벤트)
 * - error: 그대로 알린다
 */

interface Props {
  conversationId: string;
  currentBlock: BlockId;
  initialMessages: ChatMessage[];
}

export function ChatView({ conversationId, currentBlock, initialMessages }: Props) {
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
  const [artifact, setArtifact] = useState<{ slug: string; fileCount: number } | null>(null);
  /** [P4-5] 답변이 최대 길이에 걸려 끊겼는가 */
  const [truncated, setTruncated] = useState(false);
  /** [P6-4] 체험 만료·한도 초과로 막혔는가 — 요금제로 가는 길을 함께 보여준다 */
  const [blocked, setBlocked] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const blockInfo = SDVC_BLOCKS.find((b) => b.id === resolveBlock(block));

  async function send(options?: { message?: string; approved?: boolean }) {
    const message = (options?.message ?? draft).trim();
    if (!message || streaming) return;

    if (!options?.message) setDraft("");
    setError(null);
    setStreaming(true);
    setGate(null);
    setArtifact(null);
    setTruncated(false);
    setBlocked(false);
    setMessages((prev) => [...prev, { role: "user", content: message }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message,
          ...(options?.approved ? { approved: true } : {}),
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
          setMessages((prev) => appendToAssistant(prev, text));
          // scrollIntoView는 없는 환경(테스트 등)이 있으므로 있을 때만 부른다.
          endRef.current?.scrollIntoView?.({ behavior: "smooth" });
        },
        onThinking: () => setThinking(true),
        onError: (message) => setError(message),
        onGate: (gateBlock) => setGate(gateBlock),
        onBlock: (nextBlock) => setBlock(nextBlock),
        onArtifact: (published) => setArtifact(published),
        onTruncated: () => setTruncated(true),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
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
        {blockInfo && blockInfo.id !== "implement" && blockInfo.id !== "maintenance" && (
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
              {message.content}
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
              홈페이지가 만들어졌습니다 (파일 {artifact.fileCount}개)
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

        {gate && !streaming && (
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
          <Button type="submit" variant="accent" disabled={streaming}>
            {streaming ? "보내는 중…" : "보내기"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/** 마지막 assistant 메시지에 이어붙이고, 없으면 새로 만든다. */
function appendToAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return [...messages.slice(0, -1), { ...last, content: last.content + text }];
  }
  return [...messages, { role: "assistant", content: text }];
}

function gateLabel(block: BlockId): string {
  return SDVC_BLOCKS.find((b) => b.id === block)?.title.replace(" ★승인 게이트★", "") ?? "이번";
}

interface EventHandlers {
  onText: (text: string) => void;
  onThinking: () => void;
  onError: (message: string) => void;
  onGate: (block: BlockId) => void;
  onBlock: (block: BlockId) => void;
  onArtifact: (artifact: { slug: string; fileCount: number }) => void;
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
      handlers.onArtifact({ slug: event.slug, fileCount: event.fileCount ?? 0 });
    else if (event.type === "truncated") handlers.onTruncated();
    else if (event.type === "error") handlers.onError(event.message ?? "오류가 발생했습니다.");
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
