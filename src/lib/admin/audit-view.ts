import type { AuditLogRow } from "./audit";
import { formatSeoulDate, formatSeoulDateTime } from "@/lib/time/seoul";

/**
 * [P8-7b] 감사 기록을 사람이 읽을 수 있게 (FR-041).
 *
 * 실제 쌓인 기록을 먼저 보고 정했다. 셋 다 그대로는 못 읽는다:
 *   ① 행위자·대상이 UUID(`2c8303ba…`)
 *   ② 시각이 UTC — Vercel은 UTC로 돈다
 *   ③ 8건 중 5건이 "콘솔 열었음" — 새로고침마다 쌓여 나머지를 파묻는다
 *
 * **모르는 것을 조용히 버리지 않는다.** 모르는 행위는 원문 그대로,
 * 모르는 detail은 키=값으로 보여준다 — 감사 기록에서 안 보이는 값은
 * 없는 값과 같고, 그건 증거로서 치명적이다.
 */

const ACTION_LABEL: Record<string, string> = {
  "developer:read": "개발자 목록 열람",
  "developer:suspend": "계정 정지·해제",
  "developer:extend_trial": "체험 연장",
  "artifact:block": "산출물 차단",
  "usage:read": "사용량 열람",
  "audit:read": "감사 로그 열람",
  "policy:change": "정책 변경",
  "report:read": "신고 열람",
  "report:handle": "신고 처리",
};

const GRADE_LABEL: Record<string, string> = { trial: "체험", basic: "기본", pro: "프로" };

/** `2026-09-12 22:04` (한국 시각). 서버는 UTC로 돈다 — [P8-7c] 참고. */
export function formatAuditTime(iso: string): string {
  return formatSeoulDateTime(iso);
}

/** 감사 기록이므로 날짜는 `2026-10-03`처럼 또렷하게 적는다. */
function formatDay(value: unknown): string {
  return typeof value === "string" ? formatSeoulDate(value) : String(value);
}

/**
 * 콘솔을 연 기록인가.
 *
 * 지우지는 않는다 — 열람도 증거다(Clarify 20). 다만 화면에서는 접어둔다.
 */
export function isConsoleOpen(row: AuditLogRow): boolean {
  return row.action === "developer:read" && row.detail?.via === "/admin";
}

export interface AuditViewRow {
  id: string;
  /** 원본 ISO. 화면이 필요할 때 다시 쓴다 */
  at: string;
  /** 한국 시각 문자열 */
  atText: string;
  actor: string;
  action: string;
  /** 거르기에 쓰는 원문 */
  actionId: string;
  target: string | null;
  succeeded: boolean;
  summary: string;
  isConsoleOpen: boolean;
}

/** UUID를 그대로 두면 못 읽고, 비우면 사라진다 — 짧게라도 남긴다. */
function personOf(id: string | null, emails: Record<string, string>): string | null {
  if (!id) return null;
  return emails[id] ?? id.slice(0, 8);
}

/** 아는 형태는 문장으로, 모르는 형태는 키=값으로. **버리지는 않는다.** */
function summarize(row: AuditLogRow): string {
  const detail = row.detail ?? {};

  if (!row.succeeded) {
    const why = typeof detail.denied === "string" ? detail.denied : "거부됨";
    const tier = detail.tier ? ` (${detail.tier})` : "";
    return `${why}${tier}`;
  }

  if (isConsoleOpen(row)) {
    return typeof detail.count === "number"
      ? `운영 콘솔을 열었습니다 (개발자 ${detail.count}명)`
      : "운영 콘솔을 열었습니다";
  }

  switch (row.action) {
    case "developer:extend_trial":
      return detail.until ? `체험을 ${formatDay(detail.until)}까지 늘렸습니다` : "체험을 연장했습니다";

    case "developer:suspend":
      return detail.suspended === false
        ? "정지를 풀었습니다"
        : `정지했습니다${detail.reason ? ` — ${detail.reason}` : ""}`;

    case "policy:change": {
      if (detail.grade) {
        const grade = GRADE_LABEL[String(detail.grade)] ?? String(detail.grade);
        return detail.until
          ? `${grade} 등급을 ${formatDay(detail.until)}까지 부여했습니다`
          : `${grade} 등급을 무기한 부여했습니다`;
      }
      // 0은 완전 차단이다 — `detail.limit &&`로 쓰면 0이 사라진다.
      if (detail.limit !== undefined) {
        return detail.limit === null
          ? "월 한도를 등급 기본값으로 되돌렸습니다"
          : `월 한도를 ${Number(detail.limit).toLocaleString("ko-KR")} 토큰으로 정했습니다`;
      }
      if (detail.grade === null) return "부여를 해제했습니다";
      break;
    }

    case "artifact:block":
      return `산출물을 가렸습니다${detail.reason ? ` — ${detail.reason}` : ""}`;
  }

  const pairs = Object.entries(detail).map(([k, v]) => `${k}=${v}`);
  return pairs.length ? pairs.join(", ") : "—";
}

export function toAuditView(
  rows: AuditLogRow[],
  emails: Record<string, string>,
): AuditViewRow[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.created_at,
    atText: formatAuditTime(row.created_at),
    actor: personOf(row.actor_id, emails) ?? "—",
    action: ACTION_LABEL[row.action] ?? row.action,
    actionId: row.action,
    target: personOf(row.target_id, emails),
    succeeded: row.succeeded,
    summary: summarize(row),
    isConsoleOpen: isConsoleOpen(row),
  }));
}

/** 거르개에 쓸 목록 — 화면이 직접 문자열을 짜지 않게 한다. */
export const AUDIT_ACTION_OPTIONS = Object.entries(ACTION_LABEL).map(([value, label]) => ({
  value,
  label,
}));
