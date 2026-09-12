/**
 * [P8-5a] 신고 판정 (FR-013·042).
 *
 * [P2-6] `can()`과 같은 원칙: **애매하면 막는다.** 다만 막을 때는 왜
 * 막는지 말한다 — 이유 없는 거절은 같은 시도를 반복하게 만든다.
 *
 * 판정을 화면과 API가 나눠 쓰도록 순수 함수로 둔다. 화면에서만 막으면
 * 주소창으로 지나갈 수 있고, API에서만 막으면 다 쓰고 나서야 거절당한다.
 */

export const REPORT_CATEGORIES = [
  { value: "bug", label: "서비스 오류" },
  { value: "content", label: "부적절한 산출물" },
  { value: "account", label: "계정·요금" },
  { value: "other", label: "그 밖에" },
] as const;

export const REPORT_STATUSES = [
  { value: "open", label: "접수됨" },
  { value: "in_progress", label: "처리 중" },
  { value: "resolved", label: "처리 완료" },
  { value: "rejected", label: "반려" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["value"];
export type ReportStatus = (typeof REPORT_STATUSES)[number]["value"];

/** 아직 손대지 않은 것들 — 남용 판정과 접수함 정렬에 함께 쓴다. */
export const OPEN_STATUSES: ReportStatus[] = ["open", "in_progress"];

/** 한 사람이 동시에 열어둘 수 있는 신고 수. 많으면 접수함이 한 사람으로 찬다. */
export const MAX_OPEN_REPORTS = 5;

export const MIN_BODY = 10;
export const MAX_BODY = 2000;

function labelOf(list: readonly { value: string; label: string }[], value: string): string {
  return list.find((item) => item.value === value)?.label ?? value;
}

/** 모르는 값은 **원문 그대로** — 감사·신고에서 조용히 빈칸이 되는 값은 없는 값과 같다. */
export const categoryLabel = (value: string) => labelOf(REPORT_CATEGORIES, value);
export const statusLabel = (value: string) => labelOf(REPORT_STATUSES, value);

export interface ReportDraft {
  category: ReportCategory;
  body: string;
  targetUrl: string | null;
}

export interface ValidReport {
  category: ReportCategory;
  body: string;
  targetUrl: string | null;
}

export type Validated =
  | { ok: true; value: ValidReport }
  | { ok: false; error: string };

export function validateReport(draft: ReportDraft): Validated {
  const category = REPORT_CATEGORIES.find((c) => c.value === draft.category)?.value;
  if (!category) return { ok: false, error: "신고 분류를 골라주세요." };

  const body = (draft.body ?? "").trim();
  if (body.length < MIN_BODY) {
    return { ok: false, error: `무슨 일이 있었는지 ${MIN_BODY}자 이상 적어주세요.` };
  }
  if (body.length > MAX_BODY) {
    return { ok: false, error: `내용이 너무 깁니다 (${MAX_BODY}자까지).` };
  }

  // 주소는 없어도 된다 — 버그 신고에는 가리킬 주소가 없을 수 있다.
  const raw = (draft.targetUrl ?? "").trim();
  if (!raw) return { ok: true, value: { category, body, targetUrl: null } };

  let targetUrl: string;
  try {
    targetUrl = new URL(raw).toString();
  } catch {
    return { ok: false, error: "주소는 http로 시작하는 전체 주소로 적어주세요." };
  }

  return { ok: true, value: { category, body, targetUrl } };
}

export type SubmitCheck = { allowed: true } | { allowed: false; reason: string };

/**
 * 지금 이 사람이 신고를 보낼 수 있는가.
 *
 * 정지된 계정도 **로그인은 된다**(FR-014) — 들어와서 문의할 수 있어야 하니까.
 * 다만 신고 통로로 접수함을 채우게 두지는 않는다. 문의는 개인정보 처리방침에
 * 적힌 메일로 받는다.
 */
export function canSubmitReport({
  suspendedAt,
  openReports,
}: {
  suspendedAt: string | null;
  openReports: number;
}): SubmitCheck {
  if (suspendedAt) {
    return { allowed: false, reason: "정지된 계정에서는 신고를 보낼 수 없습니다." };
  }
  if (openReports >= MAX_OPEN_REPORTS) {
    return {
      allowed: false,
      reason: `아직 처리 중인 신고가 ${MAX_OPEN_REPORTS}건 있습니다. 처리된 뒤에 다시 보내주세요.`,
    };
  }
  return { allowed: true };
}
