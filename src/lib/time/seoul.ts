/**
 * [P8-7c] 이 서비스는 한국 시각으로 생각한다 (BL-012).
 *
 * 서버(Vercel)는 UTC로 돈다. 그대로 두면 운영자가 고른 날짜와 실제로
 * 저장되는 순간이 **9시간 어긋난다** — 실제로 어긋나 있었다:
 * 등급 부여에서 `2026-12-31`을 고르면 만료가 `2027-01-01 08:59:59`였고
 * 관리 화면에도 `2027. 1. 1.`로 떴다.
 *
 * 시간 계산이 여러 곳에 흩어지면 한 곳만 고쳐지는 날이 온다.
 * **한국 시각을 아는 자리는 이 파일 하나다.**
 *
 * (사용자가 여러 나라에 생기면 이 가정을 깨야 한다. 그때 고칠 자리도
 *  여기 하나다.)
 */

export const SEOUL_TZ = "Asia/Seoul";

/** 한국은 서머타임이 없다 — 고정 +09:00로 두어도 해가 바뀌어도 어긋나지 않는다. */
const OFFSET = "+09:00";

const PARTS = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function partsOf(iso: string): Record<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const out: Record<string, string> = {};
  for (const p of PARTS.formatToParts(date)) out[p.type] = p.value;
  // 자정은 로캘에 따라 "24"로 나온다 — 그대로 쓰면 날짜가 하루 밀린다.
  if (out.hour === "24") out.hour = "00";
  return out;
}

/**
 * 날짜 입력칸(`yyyy-mm-dd`)이 가리키는 **한국 시각 그날의 끝**.
 *
 * 운영자가 "12월 31일까지"라고 할 때 뜻하는 것은 한국의 12월 31일 끝이지
 * 런던의 12월 31일 끝이 아니다.
 */
export function endOfDaySeoul(day: string | null | undefined): string | null {
  if (!day || !DATE_ONLY.test(day)) return null;

  const at = new Date(`${day}T23:59:59.000${OFFSET}`);
  if (Number.isNaN(at.getTime())) return null;

  // `2026-13-45`처럼 형식은 맞고 값이 틀린 경우를 걸러낸다 — Date가
  // 조용히 다음 달로 넘겨버리기 때문이다.
  return formatSeoulDate(at.toISOString()) === day ? at.toISOString() : null;
}

/** `2026-09-13` (한국 기준). 읽을 수 없으면 원문 그대로 — 값이 사라지면 안 된다. */
export function formatSeoulDate(iso: string): string {
  const p = partsOf(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : iso;
}

/** `2026-09-13 01:00` (한국 기준). */
export function formatSeoulDateTime(iso: string): string {
  const p = partsOf(iso);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : iso;
}

/** 저장된 순간을 날짜 입력칸으로 되돌린다 — 고친 값을 다시 보여줄 때 쓴다. */
export function toSeoulDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = partsOf(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : "";
}
