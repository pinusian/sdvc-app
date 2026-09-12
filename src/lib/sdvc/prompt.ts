import { SDVC_BLOCKS, getBlock, resolveBlock, type BlockId } from "@/lib/sdvc/blocks";

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
  /** [P5-4b] 이 대화로 이미 산출물을 만들어 배포한 적이 있는가 (FR-025) */
  published?: boolean;
  /** [P7-10] 이번 메시지에 붙은 첨부의 id들 (FR-032) */
  attachmentIds?: string[];
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

/**
 * [P5-4b] 이미 만들어 배포한 프로젝트를 고치는 중일 때 덧붙이는 안내 (FR-025).
 * 이게 없으면 모델이 처음 만들 때처럼 전체 파일을 다시 써버린다.
 */
const MAINTENANCE_SECTION = [
  "## 이미 만들어진 프로젝트를 고치는 중입니다",
  "",
  "이 프로젝트는 **이미 만들어져** 주소로 서비스되고 있습니다. 사용자가 고칠 점이나",
  "추가할 기능을 말하면 처음부터 다시 만들지 말고 **고칠 파일만** 다시 내보낸다.",
  "다시 내지 않은 파일은 그대로 남으므로, 바뀌지 않는 파일은 쓸 필요가 없다.",
  "",
  "- **버그 수정**: 먼저 그 버그를 **재현**하는 방법을 한 줄로 확인하고(무엇을 하면",
  "  무엇이 잘못되는지), 고친 뒤 같은 방법으로 확인하도록 안내한다.",
  "- **기능 추가**: 기존 명세를 이어받아 무엇이 달라지는지 짧게 정리한 뒤 고친다.",
  "  처음 만들 때처럼 헌장부터 다시 묻지 않는다.",
].join("\n");

export function buildSystemPrompt({
  block,
  projectName,
  published,
  attachmentIds = [],
}: PromptState): string {
  // [P7-4b] 예전에 done으로 굳은 대화도 유지보수로 읽는다.
  const here = resolveBlock(block);
  const current = getBlock(here);
  const isMaintenance = here === "maintenance";

  const overview = SDVC_BLOCKS.map((b) => {
    const marker = b.id === here ? "▶" : "  ";
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
    // 유지보수에는 다음 단계가 없다 — 확인 버튼 안내를 넣으면 모델이 없는 게이트를 만든다.
    isMaintenance ? null : [
      "## 다음 단계로 넘어가는 방법",
      "",
      "이 블록에서 할 일을 모두 마치고 사용자의 확인만 남았을 때, 메시지 맨 마지막 줄에",
      `\`<<SDVC_GATE:${current.id}>>\` 를 붙인다. 이 표시는 화면에 보이지 않고, 사용자에게`,
      "확인 버튼을 띄우는 데 쓰인다. **이 표시가 없으면 사용자는 다음 단계로 갈 수 없다.**",
      "아직 질문에 답을 기다리는 중이거나 설명하는 중이면 붙이지 않는다.",
      "단계 이동은 오직 이 확인 버튼으로만 일어난다. 사용자가 말로 \"예\"·\"진행해줘\"라고 답해도",
      "다음 블록의 일을 미리 시작하지 말고, 이번 블록을 마무리한 뒤 이 표시를 다시 붙여",
      "확인 버튼이 뜨게 한다.",
      "**\"아래 확인 버튼을 눌러주세요\" 같은 말로 버튼을 언급했다면, 그 메시지에 반드시",
      "이 표시를 함께 낸다.** 말만 하고 표시를 빼먹으면 화면에 버튼이 나타나지 않아",
      "사용자가 아무것도 할 수 없게 된다.",
      current.requiresApproval
        ? "이 블록은 ★승인 게이트★다 — 사용자의 승인 없이는 절대 다음 블록의 일을 미리 하지 않는다."
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    // 유지보수 블록은 그 지시가 이미 본문이므로 덧붙이지 않는다.
    published && !isMaintenance ? MAINTENANCE_SECTION : null,
    attachmentIds.length > 0 ? attachmentSection(attachmentIds) : null,
    `## 항상 지킬 규칙\n\n${UNIVERSAL_RULES}`,
  ].filter((section): section is string => section !== null);

  return sections.join("\n\n");
}

/**
 * [P7-10] 붙여준 첨부를 어떻게 쓰는지 알려준다 (FR-032).
 *
 * 알려주지 않으면 모델은 "이미지는 제가 만들 수 없습니다"라고 답하고 끝난다.
 * 실제 파일은 사용자가 올린 것을 우리가 복사한다 — 모델은 **어디에 둘지만** 정한다.
 */
function attachmentSection(attachmentIds: string[]): string {
  const list = attachmentIds.map((id, index) => `- 첨부 ${index + 1}: \`${id}\``).join("\n");
  const example = attachmentIds[0];

  return [
    "## 사용자가 붙여준 첨부",
    "",
    list,
    "",
    "**이미지를 홈페이지에 넣는 방법**: 이미지는 직접 만들 수 없다. 붙여준 첨부를",
    "쓰려면 답변에 다음 한 줄을 그대로 넣는다(설명 코드블록이 아니라 지시다).",
    "",
    "```use-image:images/hero.png@" + example + "```",
    "",
    "`images/hero.png` 자리에 넣고 싶은 경로를 적는다. 그 경로로 파일이 저장되므로,",
    "HTML에서는 같은 경로를 그대로 쓴다 — 예: `<img src=\"images/hero.png\">`.",
    "확장자는 png·jpg·gif·webp만 쓴다. 글파일 첨부에는 이 지시를 쓰지 않는다.",
  ].join("\n");
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
