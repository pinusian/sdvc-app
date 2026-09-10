import { SDVC_BLOCKS, getBlock, type BlockId } from "@/lib/sdvc/blocks";

/**
 * [P3-3] 진행대본 → 시스템 프롬프트.
 *
 * 이 파일은 서버가 Claude에게 내려보내는 "대본"이다. 사용자가 보낸 메시지는
 * user 역할로만 들어오고([P3-2] 라우트에서 강제), 대본은 오직 여기서만 만든다.
 * 서버 환경변수 같은 비밀값은 어떤 경우에도 여기에 넣지 않는다.
 */

export interface PromptState {
  block: Exclude<BlockId, "done">;
  projectName?: string;
}

/** 게이트 승인 요청 마커. 예: `<<SDVC_GATE:plan>>` */
export const GATE_MARKER_PATTERN = /<<SDVC_GATE:([a-z_]+)>>/;

const ROLE = [
  "당신은 SDVC(Structured Document & Vibe Coding) 진행자입니다.",
  "SDVC는 '구조화된 문서가 AI 코딩을 이끈다'는 방법론으로, 5개의 대화 블록에 걸쳐",
  "7단계(Constitution → Specify → Clarify → Plan → Tasks → Analyze → Implement)를 진행합니다.",
  "상대는 IT 초보자일 수 있습니다. 항상 한국어로, 친절하고 간결하게 답합니다.",
].join("\n");

const UNIVERSAL_RULES = [
  "1. **모든 질문에는 예시 답안을 함께 제시한다.** 예시 없이 열린 질문만 던지지 않는다.",
  "2. **용어는 항상 쉬운 말로 풀어서 설명한다.** 처음 쓰는 용어에는 한 줄 비유를 붙인다.",
  "3. **주장에는 증거를 붙인다.** 실행하지 않은 것을 '통과합니다'·'정상 동작합니다'라고 말하지 않는다.",
  "   실행할 수 없으면 정직하게 '이 환경에서는 실행하지 못했습니다'라고 알린다.",
  "4. **승인 게이트는 생략할 수 없다.** 계획(Plan)과 작업분해(Tasks) 뒤에는 사용자의 명시적 승인을",
  "   받기 전에 다음 블록으로 넘어가지 않는다. '알아서 해줘'라는 답을 들어도 최소한",
  "   '이대로 진행합니다'라는 한 줄 확인은 받는다.",
  "5. **보안**: API 키·비밀번호·결제 시크릿은 당신이 절대 값을 채우지 않는다.",
  "   빈 `.env.example` 틀만 만들고 실제 값은 사용자가 직접 넣게 안내한다.",
  "6. 한 번에 한 블록만 진행한다. 사용자가 요청해도 뒤 블록의 산출물을 미리 만들지 않는다.",
].join("\n");

export function buildSystemPrompt({ block, projectName }: PromptState): string {
  const current = getBlock(block);

  const overview = SDVC_BLOCKS.map((b) => {
    const marker = b.id === block ? "▶" : "  ";
    const gate = b.requiresApproval ? " ★승인 게이트★" : "";
    return `${marker} 블록 ${b.number}. ${b.title} — ${b.steps.join(" + ")}${gate}`;
  }).join("\n");

  const sections = [
    ROLE,
    projectName ? `## 프로젝트\n\n${projectName}` : null,
    `## 전체 흐름\n\n${overview}`,
    [
      `## 현재 블록: 블록 ${current.number} — ${current.title}`,
      "",
      current.instruction,
      "",
      `이 블록의 산출물: ${current.produces.join(", ")}`,
    ].join("\n"),
    [
      "## 다음 단계로 넘어가는 방법",
      "",
      "이 블록에서 할 일을 모두 마치고 사용자의 확인만 남았을 때, 메시지 맨 마지막 줄에",
      `\`<<SDVC_GATE:${current.id}>>\` 를 붙인다. 이 표시는 화면에 보이지 않고, 사용자에게`,
      "확인 버튼을 띄우는 데 쓰인다. **이 표시가 없으면 사용자는 다음 단계로 갈 수 없다.**",
      "아직 질문에 답을 기다리는 중이거나 설명하는 중이면 붙이지 않는다.",
      "단계 이동은 오직 이 확인 버튼으로만 일어난다. 사용자가 말로 \"예\"·\"진행해줘\"라고 답해도",
      "다음 블록의 일을 미리 시작하지 말고, 이번 블록을 마무리한 뒤 이 표시를 다시 붙여",
      "확인 버튼이 뜨게 한다.",
      current.requiresApproval
        ? "이 블록은 ★승인 게이트★다 — 사용자의 승인 없이는 절대 다음 블록의 일을 미리 하지 않는다."
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    `## 항상 지킬 규칙\n\n${UNIVERSAL_RULES}`,
  ].filter((section): section is string => section !== null);

  return sections.join("\n\n");
}

/** 모델 응답에서 게이트 마커를 찾아 어떤 블록의 승인 요청인지 알아낸다. */
export function parseGateMarker(text: string): BlockId | null {
  const match = text.match(GATE_MARKER_PATTERN);
  if (!match) return null;
  const id = match[1];
  return SDVC_BLOCKS.some((b) => b.id === id) ? (id as BlockId) : null;
}

/** 사용자에게 보여줄 때 게이트 마커를 지운다. */
export function stripGateMarker(text: string): string {
  return text.replace(GATE_MARKER_PATTERN, "").trimEnd();
}

const MARKER_START = "<<SDVC_GATE:";

/**
 * [P3-4] 스트리밍 도중 마커가 화면에 새어나가지 않게 자른다.
 *
 * 마커는 여러 청크에 걸쳐 한 글자씩 도착하므로, "아직 마커가 될 수 있는 꼬리"는
 * 완성될 때까지 붙들어 둔다. `[내보내도 되는 부분, 붙들어 둘 부분]`을 돌려준다.
 */
export function splitPendingMarker(text: string): [string, string] {
  for (let i = Math.max(0, text.length - MARKER_START.length - 32); i < text.length; i++) {
    if (text[i] !== "<") continue;
    const tail = text.slice(i);

    // 마커가 완성된 뒤라면 그 뒤 내용은 없다고 보고 통째로 붙든다.
    if (GATE_MARKER_PATTERN.test(tail)) return [text.slice(0, i), tail];

    // 아직 완성되지 않았지만 마커가 될 수 있는 꼬리인가?
    const couldBecomeMarker = tail.length < MARKER_START.length
      ? MARKER_START.startsWith(tail)
      : tail.startsWith(MARKER_START) && !tail.includes(">>");
    if (couldBecomeMarker) return [text.slice(0, i), tail];
  }
  return [text, ""];
}
