import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminShell } from "@/components/admin/AdminShell";

/**
 * [P8-11a] 관리자 화면은 개발자 화면과 구별된다 (FR-039).
 *
 * "다르게 보인다"를 색으로 시험하면 시안이 바뀔 때마다 깨진다.
 * **무엇이 쓰여 있는가**로 시험한다 — 관리자가 읽고 판단하는 것은 글자다.
 */

function renderShell(tier: "super" | "operator" | "support" | null = "super") {
  return render(
    <AdminShell email="ops@example.com" tier={tier} logout={<button>로그아웃</button>}>
      <p>콘솔 내용</p>
    </AdminShell>,
  );
}

describe("[P8-11a] AdminShell", () => {
  it("여기가 운영 콘솔임을 밝힌다", () => {
    renderShell();
    expect(screen.getByText("운영 콘솔")).toBeInTheDocument();
  });

  it("지금 누구로 보고 있는지 밝힌다", () => {
    renderShell();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
  });

  it("관리자 등급을 우리말로 보여준다", () => {
    renderShell("support");
    expect(screen.getByText("지원")).toBeInTheDocument();
  });

  it("개발자 화면으로 돌아가는 길이 있다", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "개발자 화면" })).toHaveAttribute("href", "/dashboard");
  });

  it("상단 띠가 개발자 화면과 반대로 칠해진다 — 한눈에 다른 곳임을 안다", () => {
    const { container } = renderShell();
    const banner = container.querySelector("header");
    expect(banner?.className).toContain("bg-ink");
  });

  it("로그아웃 자리와 본문을 그대로 싣는다", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByText("콘솔 내용")).toBeInTheDocument();
  });
});
