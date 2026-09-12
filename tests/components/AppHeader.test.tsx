import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHeader } from "@/components/layout/AppHeader";

/**
 * [P8-11a] 개발자 화면의 관리자 입구 (FR-040, BL-009).
 *
 * 승격시켜 놓고 들어갈 길을 만들지 않으면 기능이 없는 것과 같다 —
 * 주소를 외우는 사람만 쓸 수 있는 기능은 쓰이지 않는다.
 */

describe("[P8-11a] AppHeader", () => {
  it("관리자에게는 서버 관리 입구를 보여준다", () => {
    render(<AppHeader isAdmin />);
    expect(screen.getByRole("link", { name: "서버 관리" })).toHaveAttribute("href", "/admin");
  });

  it("일반 개발자에게는 보이지 않는다 — 있다는 사실조차 알리지 않는다", () => {
    render(<AppHeader />);
    expect(screen.queryByRole("link", { name: "서버 관리" })).toBeNull();
  });

  it("오른쪽 자리(로그아웃 등)를 그대로 싣는다", () => {
    render(<AppHeader>{<button>로그아웃</button>}</AppHeader>);
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  });
});
