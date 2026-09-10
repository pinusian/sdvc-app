"use client";

import { useRef, useState } from "react";
import { SDVC_BLOCKS, type BlockId } from "@/lib/sdvc/blocks";
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
  const [block, setBlock] = useState<BlockId>(currentBlock);
  const endRef = useRef<HTMLDivElement>(null);

  const blockInfo = SDVC_BLOCKS.find((b) => b.id === block);

  async function send() {
    const message = draft.trim();
    if (!message || streaming) return;

    setDraft("");
    setError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content: message }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
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
      <div className="border-b border-border bg-surface px-7 py-3 text-sm text-ink-muted">
        {blockInfo ? (
          <span>
            <span className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
              블록 {blockInfo.number} / 5
            </span>{" "}
            {blockInfo.title}
          </span>
        ) : (
          <span>대화가 끝났습니다.</span>
        )}
      </div>

      <div className="mx-auto w-full max-w-[760px] flex-1 space-y-4 overflow-y-auto px-7 py-8">
        {messages.length === 0 && (
          <p className="text-center text-sm text-ink-faint">
            무엇을 만들고 싶은지 편하게 말씀해주세요. 예: &ldquo;홈페이지 만들고 싶어&rdquo;
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
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
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

interface EventHandlers {
  onText: (text: string) => void;
  onThinking: () => void;
  onError: (message: string) => void;
}

/** NDJSON 스트림을 한 줄씩 읽어 이벤트로 넘긴다. */
async function readEvents(body: ReadableStream<Uint8Array>, handlers: EventHandlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: { type: string; text?: string; message?: string };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "text" && event.text) handlers.onText(event.text);
    else if (event.type === "thinking") handlers.onThinking();
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
