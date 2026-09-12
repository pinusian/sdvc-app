import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AuditLogTable } from "@/components/admin/AuditLogTable";
import type { AuditViewRow } from "@/lib/admin/audit-view";

/**
 * [P8-7e] 감사 기록 화면 (FR-041).
 *
 * 이 화면이 답해야 하는 질문은 하나다: **누가 언제 누구에게 무엇을 했나.**
 */

function viewRow(over: Partial<AuditViewRow> = {}): AuditViewRow {
  return {
    id: "log-1",
    at: "2026-09-12T13:04:07Z",
    atText: "2026-09-12 22:04",
    actor: "ops@example.com",
    action: "체험 연장",
    actionId: "developer:extend_trial",
    target: "student@example.com",
    succeeded: true,
    summary: "체험을 2026-10-03까지 늘렸습니다",
    isConsoleOpen: false,
    ...over,
  };
}

describe("[P8-7e] AuditLogTable", () => {
  it("누가·언제·누구에게·무엇을 한 줄에 보여준다", () => {
    render(<AuditLogTable rows={[viewRow()]} hiddenCount={0} />);

    const row = screen.getByRole("row", { name: /체험 연장/ });
    expect(within(row).getByText("2026-09-12 22:04")).toBeInTheDocument();
    expect(within(row).getByText("ops@example.com")).toBeInTheDocument();
    expect(within(row).getByText("student@example.com")).toBeInTheDocument();
    expect(within(row).getByText(/2026-10-03까지 늘렸습니다/)).toBeInTheDocument();
  });

  it("거부된 시도는 눈에 띄게 표시한다 — 증거로서 가장 중요한 줄이다", () => {
    render(
      <AuditLogTable
        rows={[viewRow({ succeeded: false, summary: "등급 부족 (support)" })]}
        hiddenCount={0}
      />,
    );

    expect(screen.getByText("거부됨")).toBeInTheDocument();
  });

  it("성공한 줄에는 '거부됨'을 붙이지 않는다", () => {
    render(<AuditLogTable rows={[viewRow()]} hiddenCount={0} />);
    expect(screen.queryByText("거부됨")).toBeNull();
  });

  it("대상이 없는 행위(목록 열람 등)는 빈칸으로 둔다 — 없는 것을 지어내지 않는다", () => {
    render(<AuditLogTable rows={[viewRow({ target: null })]} hiddenCount={0} />);
    expect(screen.queryByText("student@example.com")).toBeNull();
  });

  it("접어둔 화면 열람이 몇 건인지 밝힌다 — 감췄다는 사실을 감추지 않는다", () => {
    render(<AuditLogTable rows={[viewRow()]} hiddenCount={12} />);
    expect(screen.getByText(/화면 열람 12건은 접었습니다/)).toBeInTheDocument();
  });

  it("접은 것이 없으면 그 말도 하지 않는다", () => {
    render(<AuditLogTable rows={[viewRow()]} hiddenCount={0} />);
    expect(screen.queryByText(/접었습니다/)).toBeNull();
  });

  it("기록이 없으면 비어 있다고 분명히 말한다", () => {
    render(<AuditLogTable rows={[]} hiddenCount={0} />);
    expect(screen.getByText(/기록이 없습니다/)).toBeInTheDocument();
  });
});
