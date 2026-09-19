import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountRestrictionNotice } from "@/components/auth/AccountRestrictionNotice";

vi.mock("@/app/(auth)/actions", () => ({
  logoutAction: vi.fn(),
}));

describe("[T016] 계정 제한 안내", () => {
  it("정지된 본인에게 제한 사유와 로그아웃 수단을 보여준다", () => {
    render(
      <AccountRestrictionNotice
        kind="suspended"
        reason="반복된 이용 정책 위반을 확인 중입니다."
      />,
    );

    expect(screen.getByRole("heading", { name: "계정 이용이 제한되었습니다" }))
      .toBeInTheDocument();
    expect(screen.getByText("반복된 이용 정책 위반을 확인 중입니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByText(/내부 처리 기록과 관리자 정보는/)).toBeInTheDocument();
  });

  it("정지가 아닌 비활성 상태에는 전달된 사유를 노출하지 않는다", () => {
    render(
      <AccountRestrictionNotice kind="inactive" reason="화면에 나오면 안 되는 내부 메모" />,
    );

    expect(screen.getByRole("heading", { name: "비활성화된 계정입니다" }))
      .toBeInTheDocument();
    expect(screen.queryByText("화면에 나오면 안 되는 내부 메모")).not.toBeInTheDocument();
    expect(screen.queryByText("제한 사유")).not.toBeInTheDocument();
  });

  it("조회 실패 상태에는 일반적인 안내만 표시한다", () => {
    render(<AccountRestrictionNotice kind="unavailable" reason="DB 오류 상세" />);

    expect(screen.getByRole("heading", { name: "계정 상태를 확인할 수 없습니다" }))
      .toBeInTheDocument();
    expect(screen.queryByText("DB 오류 상세")).not.toBeInTheDocument();
  });
});
