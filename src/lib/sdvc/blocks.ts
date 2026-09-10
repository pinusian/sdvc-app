/**
 * [P3-3] SDVC 진행대본의 5개 대화 블록 · 7단계 정의.
 *
 * 원본: sdvc(방법론) 저장소 `skill/sdvc-guide/references/00-guided-session-script.md`
 * Claude Code에서는 사람이 이 대본을 읽고 지켰지만, 웹서비스에서는 서버가
 * 블록 상태를 들고 매 요청마다 해당 블록의 지시만 프롬프트로 내려준다.
 *
 * 대본의 블록 0(세션 시작)과 블록 6(세션 종료)은 대화 블록이 아니라
 * progress.md 읽기/쓰기 절차이므로 여기 넣지 않는다 — 웹서비스에서는
 * 대화 상태를 DB에 저장하는 [P3-4]가 그 역할을 대신한다.
 */

export type BlockId =
  | "constitution_specify"
  | "clarify"
  | "plan"
  | "tasks"
  | "implement"
  | "done";

export interface SdvcBlock {
  id: Exclude<BlockId, "done">;
  /** 대본에서의 블록 번호 (블록 1~5) */
  number: number;
  title: string;
  /** 이 블록이 담당하는 7단계 중의 단계들 */
  steps: string[];
  /** 이 블록이 만들어내는 문서 */
  produces: string[];
  /** 블록 끝에 ★승인 게이트★가 있는가 */
  requiresApproval: boolean;
  /** 이 블록에서 AI가 할 일 (대본 발췌를 프롬프트용으로 정리한 것) */
  instruction: string;
}

export const SDVC_BLOCKS: SdvcBlock[] = [
  {
    id: "constitution_specify",
    number: 1,
    title: "헌장(Constitution) + 명세(Specify)",
    steps: ["Constitution", "Specify"],
    produces: ["docs/constitution.md", "docs/spec.md"],
    requiresApproval: false,
    instruction: [
      "1) 먼저 이번 프로젝트에서 절대 지킬 규칙(헌장)을 고르게 한다.",
      "   기본 추천: TDD 필수 / 보안 규칙(API 키·비밀번호는 커밋하지 않는다) /",
      "   기록 의무(완료마다 문서로 남긴다) / 커밋 컨벤션. 직접 추가도 받는다.",
      "2) 다음으로 '무엇을 만들고 싶은지' 자유롭게 설명하게 한다.",
      "   화면에 무엇이 보였으면 하는지, 어떤 기능이 필요한지를 편하게 말하도록 유도한다.",
      "3) 받은 설명을 다음 형식으로 정리해 보여준다:",
      "   - User Story (우선순위 P1/P2/P3)",
      "   - 기능 요구사항 (FR-001…)",
      "   - 성공 기준 (SC-001…, 숫자로 측정 가능하게)",
      "   - 이번엔 만들지 않는 것",
      "4) '빠진 게 있으면 말씀해주세요. 없으면 예라고 답해주시면 다음 단계로 갑니다'로 마무리한다.",
    ].join("\n"),
  },
  {
    id: "clarify",
    number: 2,
    title: "명확화(Clarify)",
    steps: ["Clarify"],
    produces: ["docs/spec.md (Clarifications 절 추가)"],
    requiresApproval: false,
    instruction: [
      "명세에서 애매한 지점을 찾아 **최대 5개**를 객관식으로 묻는다.",
      "각 질문에는 추천 답(권장 표시)과 예시 답안을 반드시 붙인다.",
      "애매한 점이 적으면 5개를 억지로 채우지 않는다.",
      "답을 받으면 명세의 'Clarifications' 절에 즉시 반영하고 관련 기능 요구사항을 추가한다.",
      "끝나면 '명확화가 끝났습니다. 다음은 어떻게 만들지 계획을 세울 차례입니다'라고 알린다.",
    ].join("\n"),
  },
  {
    id: "plan",
    number: 3,
    title: "계획(Plan) ★승인 게이트★",
    steps: ["Plan"],
    produces: ["docs/plan.md"],
    requiresApproval: true,
    instruction: [
      "명세를 바탕으로 기술 스택·데이터 구조·화면 구성을 정해 계획으로 정리한다.",
      "초보자에게 낯선 용어가 나오므로, 선택마다 **왜 그것을 골랐는지 쉬운 말로 근거**를 붙인다",
      "(예: 'SQLite — 별도 설치 없이 파일 하나로 동작합니다').",
      "계획 끝에 **헌장 점검**을 한 줄씩 붙인다 (규칙별로 지킴/해당 없음과 그 이유).",
      "마지막에 '이 계획대로 진행해도 될까요?'라고 묻고, 선택지를 함께 제시한다:",
      "  · 예, 이대로 진행 (권장)  · 일부 수정하고 싶어요  · 다시 설명해주세요(용어가 어려워요)",
    ].join("\n"),
  },
  {
    id: "tasks",
    number: 4,
    title: "작업 분해(Tasks) ★승인 게이트★",
    steps: ["Tasks"],
    produces: ["docs/tasks.md"],
    requiresApproval: true,
    instruction: [
      "계획을 실행 가능한 작은 작업으로 쪼갠다. **버티컬 슬라이스** 방식을 따른다 —",
      "기능 하나가 곧 슬라이스 하나이고, 슬라이스 안에서 RED→GREEN→REFACTOR를 돈다.",
      "슬라이스 하나가 끝나면 그 기능만으로도 실제 동작을 눈으로 볼 수 있어야 한다.",
      "Phase별 표(내용·작업 수)로 요약해 보여주고, 뒤로 미뤄도 앞 기능은 이미 완성된다는 점을 설명한다.",
      "마지막에 '이 순서대로 진행할까요?'라고 묻고 선택지를 제시한다:",
      "  · 예, 이 순서로 진행 (권장)  · 순서를 바꾸고 싶어요  · 기능을 더/덜 넣고 싶어요",
    ].join("\n"),
  },
  {
    id: "implement",
    number: 5,
    title: "분석(Analyze) + 구현(Implement)",
    steps: ["Analyze", "Implement"],
    produces: ["실제 코드", "docs/task-reports/"],
    requiresApproval: false,
    instruction: [
      "먼저 Analyze: 명세·계획·작업분해 사이의 모순이나 누락을 짧게 점검해 보고한다.",
      "문제가 있으면 수정 승인을 받고, 없으면 '특별한 모순은 없습니다'라고 알리고 바로 진행한다.",
      "이어서 Implement: 작업 순서대로 슬라이스 단위로 RED→GREEN→REFACTOR를 반복한다.",
      "  1) RED: 실패하는 테스트를 먼저 쓰고 실패를 확인한다",
      "  2) GREEN: 테스트를 통과시키는 최소 구현",
      "  3) REFACTOR: 정리 후 테스트 재확인",
      "슬라이스가 하나 끝날 때마다 사용자에게 알리고 실제로 확인할 기회를 준다.",
      "완료를 보고할 때는 실행한 명령과 그 출력을 함께 제시한다.",
    ].join("\n"),
  },
];

export const FIRST_BLOCK: BlockId = "constitution_specify";

const BLOCK_IDS: BlockId[] = [...SDVC_BLOCKS.map((b) => b.id), "done"];

export function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && (BLOCK_IDS as string[]).includes(value);
}

export function getBlock(id: Exclude<BlockId, "done">): SdvcBlock {
  const block = SDVC_BLOCKS.find((b) => b.id === id);
  if (!block) throw new Error(`알 수 없는 블록: ${id}`);
  return block;
}

/** 대본 순서상 다음 블록. 마지막 블록 다음은 "done", done 다음은 없다. */
export function nextBlockId(id: BlockId): BlockId | null {
  if (id === "done") return null;
  const index = SDVC_BLOCKS.findIndex((b) => b.id === id);
  if (index === -1) return null;
  return SDVC_BLOCKS[index + 1]?.id ?? "done";
}

/**
 * 다음 블록으로 넘어간다.
 * 승인 게이트가 있는 블록(Plan·Tasks)은 **명시적 승인 없이는 넘어가지 않는다** —
 * [P2-6] 권한 검사와 같은 fail-closed 원칙.
 */
export function advanceBlock(current: BlockId, { approved }: { approved: boolean }): BlockId {
  if (current === "done") return "done";
  const block = getBlock(current);
  if (block.requiresApproval && !approved) return current;
  return nextBlockId(current) ?? "done";
}
