import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createChatStream, type ChatMessage } from "@/lib/claude/chat";
import { FIRST_BLOCK, isBlockId } from "@/lib/sdvc/blocks";
import { buildSystemPrompt } from "@/lib/sdvc/prompt";

/**
 * [P3-2] SDVC 엔진과의 대화 API. [P3-3]에서 진행대본 프롬프트를 연결했다.
 *
 * 이 라우트가 책임지는 것: 로그인 확인 → 입력 검증 → 서버 키 확인 →
 * 현재 블록의 진행대본을 system 프롬프트로 붙여 Claude 스트림 전달.
 * 대화 내용의 DB 저장은 [P3-4]에서 얹는다.
 */

interface ChatRequestBody {
  messages?: unknown;
  block?: unknown;
  projectName?: unknown;
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

  const messages = parseMessages(body.messages);
  if (!messages) {
    return NextResponse.json(
      { error: "메시지가 비어 있거나 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const block = body.block ?? FIRST_BLOCK;
  if (!isBlockId(block) || block === "done") {
    return NextResponse.json(
      { error: "알 수 없는 진행 단계입니다." },
      { status: 400 },
    );
  }

  const projectName =
    typeof body.projectName === "string" && body.projectName.trim().length > 0
      ? body.projectName.trim()
      : undefined;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 어떤 환경변수가 없는지까지만 알리고 값은 절대 노출하지 않는다.
    return NextResponse.json(
      { error: "서버에 AI 연결 설정이 되어 있지 않습니다. 관리자에게 문의해주세요." },
      { status: 500 },
    );
  }

  const stream = await createChatStream({
    apiKey,
    messages,
    system: buildSystemPrompt({ block, projectName }),
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * 클라이언트가 보낸 대화 기록을 검증한다.
 * role은 user/assistant만 허용한다 — system 역할을 클라이언트가 끼워넣어
 * 진행대본을 덮어쓰는 것을 막기 위해서다([P3-3] 대비).
 */
function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.trim().length === 0) return null;
    messages.push({ role, content });
  }
  return messages;
}
