/**
 * [P7-1b] 프로젝트 이름 (FR-030).
 *
 * 지금까지는 모든 프로젝트가 "내 프로젝트"였다 — 목록에서 구분이 안 됐다(BL-002).
 *
 * 이름을 안 적은 사람에게는 **첫 요청 문장에서 규칙으로 뽑아 짓는다.**
 * 모델에게 물으면 더 잘 짓겠지만, 이름 하나 짓자고 API를 한 번 더 부를 이유가
 * 없다(돈이 든다). 규칙은 틀릴 수 있어도 "내 프로젝트"보다는 낫고,
 * 마음에 안 들면 대시보드에서 바로 고칠 수 있다.
 */

/** 이름 길이 상한. 목록 카드 한 줄에 들어가는 정도. */
export const MAX_NAME_LENGTH = 60;

/** 자동 작명이 실패했을 때 쓰는 이름 */
export const DEFAULT_PROJECT_NAME = "내 프로젝트";

/** 자동 작명 결과의 길이 상한 (사람이 적은 이름보다 짧게 잡는다) */
const SUGGEST_MAX = 24;

/** 문장 앞에 붙는 인사말 — 이름에 들어가면 안 된다 */
const GREETINGS = /^(안녕하세요|안녕|반갑습니다|저기요|저는|제가)[.,!\s]*/;

/**
 * 뒤에 붙는 요청 표현. 긴 것부터 지워야 "만들어 주세요"가
 * "만들어"만 지워지고 "주세요"가 남는 일이 없다.
 */
const REQUESTS = [
  "만들어 주시겠어요",
  "만들어 주세요",
  "만들어주세요",
  "만들고 싶어요",
  "만들고 싶어",
  "만들어 줘",
  "만들어줘",
  "만들래요",
  "만들려고요",
  "만들려고",
  "만들자",
  "만들기",
  "해주세요",
  "해줘",
  "하고 싶어요",
  "하고 싶어",
  "필요해요",
  "필요해",
];

/** 첫 요청 문장으로 프로젝트 이름을 짓는다. 뽑을 게 없으면 기본 이름. */
export function suggestProjectName(firstMessage: string): string {
  // 여러 줄을 적었다면 첫 줄이 "무엇을 만들지"인 경우가 대부분이다.
  let text = (firstMessage ?? "").split("\n")[0]?.trim() ?? "";
  text = text.replace(GREETINGS, "").trim();

  // 인사말이 한 문장을 통째로 차지했다면 그 다음 문장을 본다.
  if (!text) {
    text = (firstMessage ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  }
  // "안녕하세요. 카페 홈페이지 만들고 싶어요" 처럼 한 줄에 인사가 섞인 경우
  const afterGreeting = text.split(/(?<=[.!?])\s+/);
  if (afterGreeting.length > 1 && GREETINGS.test(afterGreeting[0])) {
    text = afterGreeting.slice(1).join(" ").trim();
  }

  for (const suffix of REQUESTS) {
    const at = text.lastIndexOf(suffix);
    // 문장 끝에 붙어 있을 때만 지운다 (가운데 있으면 내용의 일부다).
    if (at !== -1 && at + suffix.length >= text.length - 1) {
      text = text.slice(0, at).trim();
      break;
    }
  }

  text = text.replace(/[.,!?\s]+$/, "").trim();
  if (!text) return DEFAULT_PROJECT_NAME;

  if (text.length > SUGGEST_MAX) {
    // 낱말 중간에서 끊지 않는다.
    const cut = text.slice(0, SUGGEST_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    text = (lastSpace > SUGGEST_MAX / 2 ? cut.slice(0, lastSpace) : cut).trim();
  }

  return text || DEFAULT_PROJECT_NAME;
}

/**
 * 사용자가 직접 적은 이름을 검사한다. 쓸 수 없으면 null.
 *
 * **길다고 잘라서 저장하지 않는다** — 사용자가 낸 것과 다른 이름이 저장되면
 * 무엇이 바뀐 건지 알 수 없다. 거부하고 다시 적게 한다.
 */
export function normalizeProjectName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  // 줄바꿈은 공백 하나로 눕힌다 (목록 카드가 깨지지 않게).
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return null;
  if (name.length > MAX_NAME_LENGTH) return null;

  return name;
}
