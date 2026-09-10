import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { createChatStream, type ChatEvent } from "@/lib/claude/chat";
import { advanceBlock, type BlockId } from "@/lib/sdvc/blocks";
import { buildSystemPrompt, parseGateMarker, splitPendingMarker } from "@/lib/sdvc/prompt";
import {
  appendMessage,
  getConversation,
  listMessages,
  setCurrentBlock,
} from "@/lib/conversations/store";
import { publishArtifact } from "@/lib/artifacts/publish";

/**
 * SDVC 엔진과의 대화 API.
 *
 * [P3-2] 인증·입력검증·스트림 전달
 * [P3-3] 현재 블록의 진행대본을 system 프롬프트로
 * [P3-4] 대화 기록을 DB에서 읽고 쓴다 — 클라이언트는 대화 ID와 이번 메시지만 보낸다.
 *        진행 단계도 클라이언트 말이 아니라 DB에 저장된 값을 쓴다(단계 건너뛰기 방지).
 */

interface ChatRequestBody {
  conversationId?: unknown;
  message?: unknown;
  approved?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!conversationId || !message) {
    return NextResponse.json(
      { error: "대화와 메시지를 모두 보내주세요." },
      { status: 400 },
    );
  }

  // conversations/messages는 RLS 정책이 없어 브라우저에서 접근할 수 없다.
  // 서버가 secret key로 접근하되, 소유자 조건은 store가 매번 직접 건다.
  const admin = createAdminClient();

  const conversation = await getConversation(admin, conversationId, user.id);
  if (!conversation) {
    return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
  }

  // 단계 이동은 사용자가 명시적으로 승인했을 때만 일어난다.
  // (게이트가 없는 블록도 마찬가지 — 대본상 "예"라고 답해야 다음으로 간다.)
  let block: BlockId = conversation.currentBlock;
  if (body.approved === true) {
    const advanced = advanceBlock(block, { approved: true });
    if (advanced !== block) {
      await setCurrentBlock(admin, conversationId, user.id, advanced);
      block = advanced;
    }
  }
  if (block === "done") {
    return NextResponse.json({ error: "이미 끝난 대화입니다." }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 어떤 환경변수가 없는지까지만 알리고 값은 절대 노출하지 않는다.
    return NextResponse.json(
      { error: "서버에 AI 연결 설정이 되어 있지 않습니다. 관리자에게 문의해주세요." },
      { status: 500 },
    );
  }

  const history = await listMessages(admin, conversationId);
  await appendMessage(admin, { conversationId, role: "user", content: message });

  const title = conversation.title ?? undefined;
  const stream = await createChatStream({
    apiKey,
    system: buildSystemPrompt({ block, projectName: title }),
    messages: [...history, { role: "user", content: message }],
  });

  // 단계가 넘어갔으면 화면이 표시를 갱신할 수 있게 맨 앞에서 알려준다.
  const initialEvents: StreamEvent[] =
    block === conversation.currentBlock ? [] : [{ type: "block", block }];

  const publishContext: PublishContext = {
    ownerId: user.id,
    projectName: title ?? "내 프로젝트",
    projectId: conversation.projectId,
  };

  return new Response(
    stream.pipeThrough(captureAndFilter(admin, conversationId, initialEvents, publishContext)),
    {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

/** 화면으로 흘려보내는 이벤트 — Claude 쪽 이벤트에 SDVC 진행 이벤트를 더한 것. */
type StreamEvent =
  | ChatEvent
  | { type: "gate"; block: BlockId }
  | { type: "block"; block: BlockId }
  | { type: "artifact"; slug: string; fileCount: number };

interface PublishContext {
  ownerId: string;
  projectName: string;
  projectId: string | null;
}

/**
 * 흘러가는 NDJSON을 그대로 통과시키면서
 * ① 답변 텍스트를 모아 두었다가 끝나면 DB에 저장하고
 * ② 승인 게이트 마커를 걷어내 `gate` 이벤트로 바꾸고
 * ③ [P4-3] 답변에 파일이 들어 있으면 산출물로 발행한다.
 */
function captureAndFilter(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  initialEvents: StreamEvent[] = [],
  publish?: PublishContext,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const emit = (
    controller: TransformStreamDefaultController<Uint8Array>,
    event: StreamEvent,
  ) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

  let lineBuffer = "";
  let held = ""; // 마커가 될 수 있어 아직 못 내보낸 꼬리
  let answer = ""; // DB에 저장할 답변 전문(마커 제외)

  const handleLine = (
    line: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (!line.trim()) return;

    let event: ChatEvent;
    try {
      event = JSON.parse(line) as ChatEvent;
    } catch {
      return;
    }

    if (event.type !== "text") {
      emit(controller, event);
      return;
    }

    const [safe, pending] = splitPendingMarker(held + event.text);
    held = pending;
    if (safe) {
      answer += safe;
      emit(controller, { type: "text", text: safe });
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      for (const event of initialEvents) emit(controller, event);
    },
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      let newlineAt: number;
      while ((newlineAt = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, newlineAt);
        lineBuffer = lineBuffer.slice(newlineAt + 1);
        handleLine(line, controller);
      }
    },
    async flush(controller) {
      handleLine(lineBuffer, controller);

      // 붙들어 둔 꼬리가 진짜 마커였는지 확인한다.
      const gate = parseGateMarker(held);
      if (gate) {
        emit(controller, { type: "gate", block: gate });
      } else if (held) {
        answer += held;
        emit(controller, { type: "text", text: held });
      }

      const content = answer.trim();
      if (content) {
        try {
          await appendMessage(admin, { conversationId, role: "assistant", content });
        } catch (error) {
          // 저장 실패로 이미 보여준 답변을 되돌릴 수는 없으니, 알리기만 한다.
          emit(controller, {
            type: "error",
            message: error instanceof Error ? error.message : "답변 저장에 실패했습니다.",
          });
        }
      }

      // [P4-3] 답변에 파일이 들어 있으면 산출물로 발행한다. 실패해도 대화는
      // 그대로 살리고 오류만 알린다 — 대화 기록까지 잃으면 다시 만들 수 없다.
      if (content && publish) {
        try {
          const published = await publishArtifact(admin, {
            ownerId: publish.ownerId,
            conversationId,
            answer: content,
            projectName: publish.projectName,
            projectId: publish.projectId,
          });
          if (published) {
            emit(controller, {
              type: "artifact",
              slug: published.project.slug,
              fileCount: published.fileCount,
            });
          }
        } catch (error) {
          emit(controller, {
            type: "error",
            message: error instanceof Error ? error.message : "산출물 저장에 실패했습니다.",
          });
        }
      }
    },
  });
}
