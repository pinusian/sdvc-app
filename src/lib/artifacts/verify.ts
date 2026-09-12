/**
 * [P7-12] 고쳤다는 말과 실제로 고쳐졌는가 (SC-008 개정).
 *
 * 이 자리에서 두 번 다쳤다:
 *   BL-001b — 모델은 "고쳤습니다"라고 답했는데 파서가 파일을 조용히 버려
 *             홈페이지가 그대로였다
 *   BL-005b — 이미지는 저장됐는데 HTML이 안 바뀌어 화면에 변화가 없었다
 *
 * 원래 SC-008("재현 테스트(RED)가 먼저 실행된 기록")이 막으려던 것이 이것인데,
 * 정적 HTML에는 테스트 실행기가 없어 그 문구는 지킬 수 없었다. 지킬 수 있으면서
 * 같은 고통을 막는 쪽으로 바꾼다: **말한 변화가 실제 파일에 닿았는지 확인한다.**
 *
 * 판정은 여기 순수 함수로 두고, 읽고 쓰는 일은 부르는 쪽이 한다.
 */

/**
 * 이미 끝냈다고 **주장**하는 표현들.
 *
 * "고치겠습니다"(예고)는 뺀다 — 아직 안 한 것을 두고 경고하면
 * 물어보는 중에도 경고가 뜬다. 시끄러운 경고는 곧 무시되는 경고다.
 */
const DONE_CLAIM =
  /(고쳤|바꿨|바꾸었|수정했|수정하였|추가했|추가하였|삭제했|삭제하였|지웠|반영했|반영하였|적용했|적용하였|넣었|바꿔놓|고쳐놓)/;

export function claimsChange(answer: string): boolean {
  return DONE_CLAIM.test(answer.trim());
}

/** 경고 한 줄에 이름을 몇 개까지 적을지. 길면 아무도 안 읽는다. */
const MAX_NAMES = 3;

/**
 * 낸 파일 중 내용이 그대로인 것들을 짚어준다.
 *
 * 전부 그대로면 "고쳤다는데 바뀐 것이 없다"는 뜻이고, 일부면 그 파일만 짚는다.
 * 다 바뀌었으면 **아무 말도 하지 않는다** — 잘 된 일에 경고를 붙이면
 * 경고가 배경 소음이 된다.
 */
export function describeUnchanged(
  written: string[] | undefined,
  unchanged: string[] | undefined,
): string | null {
  // 확인은 덤이다 — 여기서 터져 발행을 죽이면 본말이 뒤바뀐다.
  if (!written?.length || !unchanged?.length) return null;

  const all = unchanged.length === written.length;
  const shown = unchanged.slice(0, MAX_NAMES).join(", ");
  const rest = unchanged.length - MAX_NAMES;
  const names = rest > 0 ? `${shown} 외 ${rest}개` : shown;

  return all
    ? `고쳤다고 했지만 실제로 바뀐 것이 없습니다 (${unchanged.length}개 파일: ${names}). ` +
        `무엇이 어떻게 달라져야 하는지 한 번 더 말씀해주세요.`
    : `일부 파일은 그대로입니다 (${names}). 의도한 것이 아니면 다시 말씀해주세요.`;
}

/**
 * 고쳤다고 했는데 **파일이 하나도 나오지 않은** 경우.
 *
 * BL-001b가 정확히 이것이었다. `publishArtifact`는 낼 것이 없으면 `null`을
 * 돌려주고 부르는 쪽은 조용히 넘어갔다 — 사용자는 고쳐진 줄 알았다.
 */
export const NOTHING_WRITTEN =
  "고쳤다고 했지만 저장된 파일이 없습니다. 바뀐 내용이 홈페이지에 반영되지 않았습니다 — " +
  "다시 한 번 요청해주세요.";
