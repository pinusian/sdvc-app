import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import {
  createChatStream,
  DEFAULT_MAX_TOKENS,
  type ChatEvent,
  type ChatMessage,
  type ContentBlock,
} from "@/lib/claude/chat";

/**
 * 파일을 통째로 써야 하는 단계는 훨씬 긴 답변을 허용한다([P4-5]).
 * 유지보수([P7-4b])도 고친 파일을 다시 내므로 같은 길이가 필요하다.
 */
const IMPLEMENT_MAX_TOKENS = 32_000;
/** 옛 `done`을 걷어낸, 실제로 진행 중일 수 있는 블록 */
type LiveBlockId = Exclude<BlockId, "done">;
const LONG_ANSWER_BLOCKS: LiveBlockId[] = ["implement", "maintenance"];
import { advanceBlock, resolveBlock, type BlockId } from "@/lib/sdvc/blocks";
import { buildSystemPrompt, parseGateMarker, splitPendingMarker } from "@/lib/sdvc/prompt";
import {
  appendMessage,
  getConversation,
  listMessages,
  setCurrentBlock,
} from "@/lib/conversations/store";
import { publishArtifact } from "@/lib/artifacts/publish";
import { NOTHING_WRITTEN, claimsChange } from "@/lib/artifacts/verify";
import { loadCurrentFiles } from "@/lib/artifacts/current";
import { recordUsage } from "@/lib/usage/store";
import { loadAccountState } from "@/lib/billing/account";
import { canCreateProject, canStartChat } from "@/lib/billing/access";
import { suggestProjectName } from "@/lib/projects/name";
import { AttachmentError, buildAttachmentBlocks } from "@/lib/attachments/message";
import { cleanupStream, registerActiveWork } from "@/lib/execution/active-work";

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
  /** [P7-9] 프롬프트에 붙인 첨부의 id들. 내용은 서버가 저장소에서 다시 읽는다 */
  attachmentIds?: unknown;
}

/**
 * [BL-022] 실행 시간 한도 — Vercel Hobby의 상한인 300초.
 *
 * [BL-021b]에서 "플랫폼 기본값에 맡기면 위험하다"며 60으로 적었는데,
 * **Hobby 기본값이 이미 300초였다**(Fluid compute). 한도를 늘린 게 아니라
 * 줄였고, 계획·작업분해·구현처럼 답이 긴 단계가 전부 60초에 끊겨
 * **답변도 사용량도 저장되지 않았다**(2026-09-14 실사용자 대화).
 *
 * 줄이고 싶어지면 먼저 가장 긴 단계의 실제 소요 시간을 잴 것.
 * 요금제 상한(300)을 넘겨 적으면 배포가 거부된다.
 */
export const maxDuration = 300;

/**
 * [BL-021a] 예상 못 한 오류를 사용자가 읽을 수 있는 말로 바꾼다.
 *
 * 예외를 그대로 터뜨리면 플랫폼이 JSON 없는 맨 500을 내보내고, 화면은
 * "요청에 실패했습니다. (상태 500)"만 띄운다 — 무슨 일인지도 모르고,
 * 사용자가 공들여 쓴 글까지 사라진다(실제로 그랬다).
 *
 * 속사정(연결 문자열·스택)은 내보내지 않는다. 서버 로그에만 남긴다.
 */
export async function POST(request: Request) {
  try {
    return await handleChat(request);
  } catch (error) {
    console.error("[api/chat] 처리되지 않은 오류", error);
    return NextResponse.json(
      {
        error:
          "요청을 처리하지 못했습니다. 잠시 뒤 다시 보내주세요. " +
          "계속 같은 문제가 생기면 신고 화면으로 알려주세요.",
      },
      { status: 500 },
    );
  }
}

async function handleChat(request: Request) {
  const routeAccess = await requireLearnerAccess();
  if (!routeAccess.ok) return routeAccess.response;
  const { user } = routeAccess;

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

  // [P6-4] 체험 기간·구독 상태·월 한도를 서버에서 판정한다 (FR-008·FR-026).
  // Claude를 부르기 전에, 그리고 메시지를 저장하기 전에 막아야 한다 —
  // 막힌 요청으로 비용이 나가거나 대화가 지저분해지면 안 되기 때문이다.
  const account = await loadAccountState(admin, user.id);
  const access = account
    ? canStartChat(account)
    : ({
        allowed: false as const,
        reason: "unknown_grade" as const,
        message: "계정 정보를 확인할 수 없습니다. 관리자에게 문의해주세요.",
      });

  if (!access.allowed) {
    return NextResponse.json(
      {
        error: access.message,
        reason: access.reason,
        ...(access.upgradeTo ? { upgradeTo: access.upgradeTo } : {}),
      },
      { status: 402 }, // Payment Required
    );
  }

  // access.allowed가 참이 될 수 있는 유일한 경우는 account가 있을 때다
  // (위 삼항의 다른 가지는 항상 allowed:false). 여기부터는 안전하게 단정한다.
  const verifiedAccount = account!;

  // 단계 이동은 사용자가 명시적으로 승인했을 때만 일어난다.
  // (게이트가 없는 블록도 마찬가지 — 대본상 "예"라고 답해야 다음으로 간다.)
  // [P7-4b] 예전에 done으로 굳은 대화도 유지보수로 읽어 다시 열어준다 (FR-029).
  // 여기서 막으면 "이어서 수정"이 통째로 죽는다 — 실제로 그랬다(BL-001).
  // `done`은 여기서 걷어내므로 이 아래로는 실재하는 블록만 흐른다.
  let block: LiveBlockId = resolveBlock(conversation.currentBlock);

  // [BL-022] 승인은 **지금 블록의 답을 보고** 하는 것이다. 마지막 메시지가 답이
  // 아니면(답이 도중에 끊겨 저장되지 않았으면) 승인할 대상이 없다 — 넘기지 않고
  // 지금 블록의 일을 다시 하게 한다. 예전에는 끊긴 뒤 "다음 단계로"를 누를
  // 때마다 넘어가, 계획서도 작업분해도 없이 구현에 도착했다(2026-09-14).
  const history = await listMessages(admin, conversationId);
  const hasAnswerToApprove = history[history.length - 1]?.role === "assistant";

  if (body.approved === true && hasAnswerToApprove) {
    const advanced = resolveBlock(advanceBlock(block, { approved: true }));
    if (advanced !== block) {
      await setCurrentBlock(admin, conversationId, user.id, advanced);
      block = advanced;
    }
  }

  // [BL-014] `canCreateProject`는 [P6-3]부터 있었지만 아무도 부르지 않았다 —
  // 대시보드는 "프로젝트 0 / 1개"라고 알리면서 실제로는 무제한으로 만들 수
  // 있었다. **새 프로젝트를 만들려는 순간**(구현 단계 + 아직 연결된 프로젝트
  // 없음)에만 본다 — 이미 만든 프로젝트를 고치는 turn까지 막으면 그 프로젝트
  // 자체를 못 쓰게 되고, 계획·작업분해 같은 이전 블록에서 막으면 프로젝트를
  // 만들지도 않았는데 거절하는 셈이다. canStartChat과 같은 이유로 Claude를
  // 부르기 전에, 메시지를 저장하기 전에 확인한다.
  if (block === "implement" && !conversation.projectId) {
    const projectAccess = canCreateProject(verifiedAccount);
    if (!projectAccess.allowed) {
      return NextResponse.json(
        {
          error: projectAccess.message,
          reason: projectAccess.reason,
          ...(projectAccess.upgradeTo ? { upgradeTo: projectAccess.upgradeTo } : {}),
        },
        { status: 402 },
      );
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 어떤 환경변수가 없는지까지만 알리고 값은 절대 노출하지 않는다.
    return NextResponse.json(
      { error: "서버에 AI 연결 설정이 되어 있지 않습니다. 관리자에게 문의해주세요." },
      { status: 500 },
    );
  }

  // [P7-9] 첨부는 Claude를 부르기 **전에** 준비한다 — 여기서 실패하면
  // 메시지를 저장하지도, 돈을 쓰지도 않는다.
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((id): id is string => typeof id === "string")
    : [];
  let attachmentBlocks: ContentBlock[] = [];
  if (attachmentIds.length > 0) {
    try {
      attachmentBlocks = await buildAttachmentBlocks(admin, {
        ownerId: user.id,
        conversationId,
        attachmentIds,
      });
    } catch (error) {
      const message =
        error instanceof AttachmentError
          ? error.message
          : "첨부를 읽지 못했습니다. 다시 올려주세요.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  await appendMessage(admin, { conversationId, role: "user", content: message });

  const title = conversation.title ?? undefined;

  // [BL-018] 이미 만든 프로젝트면 **지금 저장된 파일**을 함께 알려준다.
  // 대화 기록만 믿으면 되돌리기(P7-7) 뒤에 없는 버전을 고치게 되고,
  // 기록이 잘린 대화에서는 "내용을 붙여넣어 주세요"라고 되묻는다.
  const currentFiles = conversation.projectId
    ? await loadCurrentFiles(admin, conversation.projectId)
    : undefined;

  const workController = new AbortController();
  const unregisterWork = registerActiveWork(user.id, workController);
  const abortFromRequest = () => workController.abort();
  request.signal.addEventListener("abort", abortFromRequest, { once: true });
  const cleanupWork = () => {
    request.signal.removeEventListener("abort", abortFromRequest);
    unregisterWork();
  };

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await createChatStream({
      apiKey,
      system: buildSystemPrompt({
        block,
        projectName: title,
        // [P5-4b] 이미 만든 프로젝트면 전체를 다시 만들지 않도록 알려준다 (FR-025)
        published: Boolean(conversation.projectId),
        // [P7-10] 붙여준 첨부를 홈페이지에 넣는 방법을 알려준다 (FR-032)
        attachmentIds,
        currentFiles,
      }),
      messages: [
        ...history,
        // 첨부가 있으면 글 대신 블록으로 보낸다. 첨부를 먼저 두어야 모델이
        // "이 사진에 대해서" 같은 말을 제대로 받는다.
        attachmentBlocks.length > 0
          ? {
              role: "user" as const,
              content: [...attachmentBlocks, { type: "text" as const, text: message }],
            }
          : { role: "user" as const, content: message },
      ],
      // 구현 단계는 파일을 통째로 써야 해서 기본 길이로는 중간에 끊긴다([P4-5]
      // 검증에서 실제로 겪음). max_tokens는 상한일 뿐이라 늘려도 안 쓰면 비용은 없다.
      maxTokens: LONG_ANSWER_BLOCKS.includes(block) ? IMPLEMENT_MAX_TOKENS : DEFAULT_MAX_TOKENS,
      signal: workController.signal,
    });
  } catch (error) {
    cleanupWork();
    throw error;
  }

  // 단계가 넘어갔으면 화면이 표시를 갱신할 수 있게 맨 앞에서 알려준다.
  const initialEvents: StreamEvent[] =
    block === resolveBlock(conversation.currentBlock) ? [] : [{ type: "block", block }];

  const publishContext: PublishContext = {
    ownerId: user.id,
    // [P7-1b] 이름을 안 적었으면 첫 요청 문장으로 짓는다 (FR-030).
    // 모델을 한 번 더 부르지 않는다 — 이름 하나에 돈을 쓸 이유가 없다.
    projectName: title ?? suggestProjectName(firstUserMessage(history, message)),
    // 항상 null 또는 문자열로 맞춘다 (undefined가 DB까지 흘러가면 컬럼이 빠진다)
    projectId: conversation.projectId ?? null,
    request: message,
  };

  return new Response(
    cleanupStream(
      stream.pipeThrough(captureAndFilter(admin, conversationId, initialEvents, publishContext)),
      cleanupWork,
    ),
    {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

/** 이름을 지을 근거가 되는 첫 사용자 발화. 기록이 비었으면 이번 메시지. */
function firstUserMessage(history: ChatMessage[], current: string): string {
  const first = history.find((m) => m.role === "user")?.content;
  // 첨부가 붙은 메시지는 블록 배열이다 — 글 부분만 모아서 본다([P7-9]).
  if (typeof first === "string") return first;
  if (Array.isArray(first)) {
    const text = first
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return current;
}

/** 화면으로 흘려보내는 이벤트 — Claude 쪽 이벤트에 SDVC 진행 이벤트를 더한 것. */
type StreamEvent =
  | ChatEvent
  | { type: "gate"; block: BlockId }
  | { type: "block"; block: BlockId }
  | { type: "artifact"; slug: string; fileCount: number; imageCount: number };

interface PublishContext {
  ownerId: string;
  projectName: string;
  projectId: string | null;
  /** [P7-6a] 이번 사용자 요청 — 버전 목록의 설명이 된다 */
  request: string;
}

/** [P6-2] 스트림에서 걷어낸 사용량 — 화면에는 보내지 않고 기록만 한다. */
type Usage = { model: string; inputTokens: number; outputTokens: number };

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
  let usage: Usage | null = null; // [P6-2] 이번 호출의 사용량

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

    // [P6-2] 사용량은 과금·한도 판정용이지 보여줄 것이 아니다 — 걷어낸다.
    if (event.type === "usage") {
      usage = {
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      };
      return;
    }

    // [BL-022] done은 여기서 넘기지 않는다 — Claude가 끝난 것일 뿐 저장은 아직이다.
    if (event.type === "done") return;

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

      // [P6-2] 사용량 기록. 실패해도 대화는 망가뜨리지 않는다 — 기록보다
      // 사용자의 대화가 우선이고, 누락분은 나중에 원가 집계에서 드러난다.
      if (usage && publish) {
        try {
          await recordUsage(admin, {
            userId: publish.ownerId,
            conversationId,
            projectId: publish.projectId,
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          });
        } catch {
          // 조용히 넘긴다 (사용자에게 보일 오류가 아니다)
        }
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
            // [P7-6a] 버전 목록에서 "무엇을 고쳐서 이렇게 됐는지" 보이도록
            request: publish.request,
          });
          if (published) {
            emit(controller, {
              type: "artifact",
              slug: published.project.slug,
              fileCount: published.fileCount,
              imageCount: published.imageCount ?? 0,
            });
            // [P7-10] 못 넣은 이미지는 **조용히 넘어가지 않는다** — 모델이
            // "넣었습니다"라고 답했는데 사진이 없으면 사용자는 알 길이 없다.
            for (const warning of published.warnings ?? []) {
              emit(controller, { type: "error", message: warning });
            }
          } else if (publish.projectId && claimsChange(content)) {
            // [P7-12] 고쳤다고 해놓고 **파일을 하나도 내지 않은** 경우 (SC-008).
            // publishArtifact는 낼 것이 없으면 null을 돌려주고, 예전에는 여기서
            // 조용히 넘어갔다 — 사용자는 고쳐진 줄 알았다(BL-001b).
            emit(controller, { type: "error", message: NOTHING_WRITTEN });
          }
        } catch (error) {
          emit(controller, {
            type: "error",
            message: error instanceof Error ? error.message : "산출물 저장에 실패했습니다.",
          });
        }
      }

      // [BL-022] 저장·발행까지 **다 끝났다**는 신호. 화면은 이것을 못 받으면
      // 도중에 끊긴 것으로 안다 — 서버가 시간 한도로 강제 종료되면 여기까지 오지 못한다.
      emit(controller, { type: "done" });
    },
  });
}
