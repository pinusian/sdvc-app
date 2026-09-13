import { describe, expect, it } from "vitest";
import {
  formatAuditTime,
  isConsoleOpen,
  toAuditView,
  type AuditViewRow,
} from "@/lib/admin/audit-view";
import type { AuditLogRow } from "@/lib/admin/audit";

/**
 * [P8-7b] 감사 기록을 사람이 읽을 수 있게 (FR-041).
 *
 * 실제 쌓인 기록을 보고 정했다: 8건 중 5건이 "콘솔 열었음"이고,
 * 행위자·대상은 UUID이며, 시각은 UTC다. 셋 다 그대로는 못 읽는다.
 */

function row(over: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: "log-1",
    actor_id: "admin-1",
    action: "developer:extend_trial",
    target_type: "profile",
    target_id: "user-9",
    succeeded: true,
    detail: { until: "2026-10-03T11:37:22.078Z" },
    created_at: "2026-09-12T13:04:07.609Z",
    ...over,
  };
}

const EMAILS: Record<string, string> = {
  "admin-1": "ops@example.com",
  "user-9": "student@example.com",
};

const first = (rows: AuditLogRow[], emails = EMAILS): AuditViewRow =>
  toAuditView(rows, emails)[0];

describe("[P8-7b] toAuditView — 누가 무엇을", () => {
  it("UUID가 아니라 이메일로 보여준다", () => {
    const v = first([row()]);
    expect(v.actor).toBe("ops@example.com");
    expect(v.target).toBe("student@example.com");
  });

  it("탈퇴해 사라진 계정은 짧은 id로 — 빈칸으로 두지 않는다", () => {
    const v = first([row({ actor_id: "gone-abcdefgh", target_id: null })], {});
    expect(v.actor).toBe("gone-abc");
    expect(v.target).toBeNull();
  });

  it("행위를 우리말로 옮긴다", () => {
    expect(first([row({ action: "developer:extend_trial" })]).action).toBe("체험 연장");
    expect(first([row({ action: "developer:suspend" })]).action).toBe("계정 정지·해제");
    expect(first([row({ action: "policy:change" })]).action).toBe("정책 변경");
    expect(first([row({ action: "audit:read" })]).action).toBe("감사 로그 열람");
  });

  it("모르는 행위는 원문 그대로 — 조용히 빈칸이 되지 않는다", () => {
    expect(first([row({ action: "future:thing" })]).action).toBe("future:thing");
  });
});

describe("[P8-7b] toAuditView — 무슨 일이 있었나", () => {
  it("체험 연장은 언제까지 늘렸는지 말한다", () => {
    expect(first([row()]).summary).toContain("2026-10-03");
  });

  it("등급 부여는 무슨 등급을 언제까지인지 말한다", () => {
    // 한국 시각 2026-12-31 끝 = 14:59:59Z ([P8-7c] endOfDaySeoul)
    const v = first([
      row({ action: "policy:change", detail: { grade: "pro", until: "2026-12-31T14:59:59Z" } }),
    ]);
    expect(v.summary).toContain("프로");
    expect(v.summary).toContain("2026-12-31");
  });

  it("BL-012 이전에 잘못 저장된 값은 **그대로** 보고한다 — 감사 기록은 과거를 고쳐 쓰지 않는다", () => {
    // 운영자는 2026-12-31을 골랐지만 UTC 자정으로 저장돼 실제 만료는 한국 2027-01-01이었다.
    // 화면이 의도를 짐작해 2026-12-31로 보여주면, 기록과 실제가 어긋난 사실이 감춰진다.
    const v = first([
      row({ action: "policy:change", detail: { grade: "pro", until: "2026-12-31T23:59:59Z" } }),
    ]);
    expect(v.summary).toContain("2027-01-01");
  });

  it("한도 0은 '없음'이 아니라 0으로 보여준다 — 완전 차단이다", () => {
    const v = first([row({ action: "policy:change", detail: { limit: 0 } })]);
    expect(v.summary).toContain("0");
  });

  it("정지는 사유를 그대로 싣는다 — 나중에 왜 정지했는지 알아야 한다", () => {
    const v = first([
      row({ action: "developer:suspend", detail: { suspended: true, reason: "불법 콘텐츠" } }),
    ]);
    expect(v.summary).toContain("불법 콘텐츠");
  });

  it("거부된 시도는 눈에 띄게 표시하고 사유를 남긴다", () => {
    const v = first([
      row({ succeeded: false, detail: { denied: "등급 부족", tier: "support" } }),
    ]);
    expect(v.succeeded).toBe(false);
    expect(v.summary).toContain("등급 부족");
  });

  it("모르는 형태의 detail도 버리지 않고 키=값으로 보여준다", () => {
    const v = first([row({ action: "future:thing", detail: { foo: "bar", n: 3 } })]);
    expect(v.summary).toContain("foo=bar");
    expect(v.summary).toContain("n=3");
  });

  it("detail이 없어도 터지지 않는다", () => {
    expect(() => first([row({ detail: null })])).not.toThrow();
  });

  it("[BL-020] detail 값이 중첩 객체여도 [object Object]가 아니라 안을 펼쳐 보여준다", () => {
    // /admin/audit 자신의 감사 기록이 정확히 이 모양이다: filter가 객체다
    const v = first([
      row({
        action: "audit:read",
        detail: { via: "/admin/audit", count: 19, filter: { action: null, denied: null, opens: null } },
      }),
    ]);

    expect(v.summary).not.toContain("[object Object]");
    expect(v.summary).toContain("action=null");
    expect(v.summary).toContain("denied=null");
  });

  it("[BL-020] detail 값이 배열이어도 펼쳐 보여준다", () => {
    const v = first([row({ action: "future:thing", detail: { tags: ["a", "b"] } })]);

    expect(v.summary).not.toContain("[object Object]");
    expect(v.summary).toContain("a");
    expect(v.summary).toContain("b");
  });
});

describe("[P8-7b] 화면 열람은 따로 센다", () => {
  it("콘솔을 연 기록임을 알아본다 — 새로고침마다 쌓여 나머지를 파묻는다", () => {
    expect(isConsoleOpen(row({ action: "developer:read", detail: { via: "/admin", count: 5 } }))).toBe(
      true,
    );
  });

  it("같은 developer:read여도 콘솔 열람이 아니면 아니다", () => {
    expect(isConsoleOpen(row({ action: "developer:read", detail: { via: "/api" } }))).toBe(false);
    expect(isConsoleOpen(row({ action: "policy:change" }))).toBe(false);
  });

  it("뷰에도 표시가 실린다", () => {
    const v = first([row({ action: "developer:read", detail: { via: "/admin", count: 5 } })]);
    expect(v.isConsoleOpen).toBe(true);
  });
});

describe("[P8-7b] formatAuditTime", () => {
  it("서버가 UTC로 돌아도 한국 시각으로 보여준다", () => {
    // 2026-09-12T13:04:07Z = 한국 2026-09-12 22:04
    const text = formatAuditTime("2026-09-12T13:04:07.609Z");
    expect(text).toContain("2026");
    expect(text).toContain("22:04");
  });

  it("날짜가 넘어가는 경우도 한국 기준으로 옮긴다", () => {
    // 2026-09-12T16:00Z = 한국 2026-09-13 01:00
    expect(formatAuditTime("2026-09-12T16:00:00Z")).toContain("09-13");
  });
});
