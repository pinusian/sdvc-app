import { describe, expect, it } from "vitest";
import {
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  canSubmitReport,
  categoryLabel,
  statusLabel,
  validateReport,
  type ReportDraft,
} from "@/lib/reports/policy";

/**
 * [P8-5a] 신고 판정 (FR-013·042).
 *
 * [P2-6] `can()`과 같은 원칙: **애매하면 막는다.**
 * 다만 막을 때는 왜 막는지 말한다 — 이유 없는 거절은 다시 시도하게 만든다.
 */

const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  category: "bug",
  body: "대화 도중에 화면이 멈춰서 더 진행되지 않습니다.",
  targetUrl: null,
  ...over,
});

describe("[P8-5a] validateReport", () => {
  it("제대로 쓴 신고는 통과한다", () => {
    expect(validateReport(draft())).toEqual({ ok: true, value: expect.anything() });
  });

  it("내용이 너무 짧으면 막는다 — 무엇을 고쳐야 할지 알 수 없다", () => {
    const result = validateReport(draft({ body: "이상함" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("10자");
  });

  it("공백만 채운 것은 쓴 것이 아니다", () => {
    expect(validateReport(draft({ body: "          " })).ok).toBe(false);
  });

  it("너무 길면 막는다", () => {
    expect(validateReport(draft({ body: "가".repeat(2001) })).ok).toBe(false);
  });

  it("모르는 분류는 막는다 — 애매하면 막는다", () => {
    expect(validateReport(draft({ category: "해킹" as never })).ok).toBe(false);
  });

  it("앞뒤 공백은 떼고 저장한다", () => {
    const result = validateReport(draft({ body: "  화면이 멈춥니다. 다시 눌러도 그대로입니다.  " }));
    if (result.ok) expect(result.value.body.startsWith("화면이")).toBe(true);
  });

  it("주소를 적지 않아도 된다 — 버그 신고에는 주소가 없을 수 있다", () => {
    expect(validateReport(draft({ targetUrl: null })).ok).toBe(true);
    expect(validateReport(draft({ targetUrl: "   " })).ok).toBe(true);
  });

  it("주소를 적었으면 진짜 주소여야 한다", () => {
    expect(validateReport(draft({ targetUrl: "그냥 아무 말" })).ok).toBe(false);
    expect(validateReport(draft({ targetUrl: "https://sdvc-app.vercel.app/site/bakery" })).ok).toBe(
      true,
    );
  });
});

describe("[P8-5a] canSubmitReport", () => {
  it("평범한 개발자는 보낼 수 있다", () => {
    expect(canSubmitReport({ suspendedAt: null, openReports: 0 })).toEqual({ allowed: true });
  });

  it("정지된 계정은 보낼 수 없다 — 왜인지 말해준다", () => {
    const result = canSubmitReport({ suspendedAt: "2026-09-01T00:00:00Z", openReports: 0 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("정지");
  });

  it("처리 대기 중인 내 신고가 5건이면 더 못 보낸다", () => {
    expect(canSubmitReport({ suspendedAt: null, openReports: 4 }).allowed).toBe(true);
    expect(canSubmitReport({ suspendedAt: null, openReports: 5 }).allowed).toBe(false);
  });

  it("막을 때는 무엇을 기다려야 하는지 말한다", () => {
    const result = canSubmitReport({ suspendedAt: null, openReports: 5 });
    if (!result.allowed) expect(result.reason).toContain("처리");
  });
});

describe("[P8-5a] 이름표", () => {
  it("분류와 상태를 우리말로 옮긴다", () => {
    expect(categoryLabel("content")).toBe("부적절한 산출물");
    expect(statusLabel("in_progress")).toBe("처리 중");
    expect(statusLabel("rejected")).toBe("반려");
  });

  it("모르는 값은 원문 그대로 — 조용히 빈칸이 되지 않는다", () => {
    expect(categoryLabel("미래분류")).toBe("미래분류");
    expect(statusLabel("미래상태")).toBe("미래상태");
  });

  it("화면이 쓸 목록을 내어준다", () => {
    expect(REPORT_CATEGORIES.map((c) => c.value)).toEqual(["bug", "content", "account", "other"]);
    expect(REPORT_STATUSES.map((s) => s.value)).toEqual([
      "open",
      "in_progress",
      "resolved",
      "rejected",
    ]);
  });
});
