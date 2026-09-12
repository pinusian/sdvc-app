import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminSignIn } from "@/components/admin/AdminSignIn";

/**
 * [P8-12] 관리자 로그인 화면 (FR-038).
 *
 * 엉뚱한 계정으로 로그인한 채 들어온 사람에게 **지금 누구인지**와
 * **무엇을 하면 되는지**를 말해준다. 이전에는 맨 404였다.
 */

const noop = vi.fn();

describe("[P8-12] AdminSignIn", () => {
  it("로그인 전에는 계정 안내 없이 로그인만 받는다", () => {
    render(<AdminSignIn signedInAs={null} action={noop} logoutAction={noop} pending={false} />);

    expect(screen.getByRole("heading", { name: "서버 관리자 로그인" })).toBeInTheDocument();
    expect(screen.queryByText(/계정으로 로그인되어 있습니다/)).toBeNull();
  });

  it("자격 없는 계정으로 들어오면 지금 누구인지 알려준다", () => {
    render(
      <AdminSignIn signedInAs="pbc6989@naver.com" action={noop} logoutAction={noop} pending={false} />,
    );

    expect(screen.getByText(/pbc6989@naver.com/)).toBeInTheDocument();
    expect(screen.getByText(/이 계정으로는 운영 콘솔에 들어올 수 없습니다/)).toBeInTheDocument();
  });

  it("다른 계정으로 갈아탈 길과 자기 화면으로 돌아갈 길을 준다", () => {
    render(
      <AdminSignIn signedInAs="pbc6989@naver.com" action={noop} logoutAction={noop} pending={false} />,
    );

    expect(screen.getByRole("button", { name: "다른 계정으로 로그인" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "개발자 화면으로" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("관리자는 가입해서 되는 것이 아니므로 가입 링크를 두지 않는다", () => {
    render(<AdminSignIn signedInAs={null} action={noop} logoutAction={noop} pending={false} />);
    expect(screen.queryByRole("link", { name: /가입/ })).toBeNull();
  });
});
