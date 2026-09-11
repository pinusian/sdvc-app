import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PricingPlans } from "@/components/billing/PricingPlans";

/**
 * [P6-8] 요금제 화면.
 *
 * IT를 잘 모르는 사람도 "얼마에 무엇을 쓸 수 있는지"를 한눈에 알아야 하고,
 * 결제하기를 누르면 Stripe 결제창으로 넘어가야 한다.
 *
 * 이동은 prop으로 주입받는다 — jsdom의 location은 바꿔치기할 수 없기 때문이다.
 */

describe("[P6-8] PricingPlans", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("세 등급의 값과 한도를 보여준다", () => {
    render(<PricingPlans currentGrade="trial" subscriptionStatus="none" />);

    expect(screen.getByText("체험")).toBeInTheDocument();
    expect(screen.getByText(/\$12/)).toBeInTheDocument();
    expect(screen.getByText(/\$35/)).toBeInTheDocument();
    expect(screen.getByText(/프로젝트 1개/)).toBeInTheDocument();
    expect(screen.getByText(/프로젝트 3개/)).toBeInTheDocument();
    expect(screen.getByText(/프로젝트 10개/)).toBeInTheDocument();
    expect(screen.getByText(/50만/)).toBeInTheDocument();
    expect(screen.getByText(/200만/)).toBeInTheDocument();
    expect(screen.getByText(/800만/)).toBeInTheDocument();
  });

  it("지금 쓰는 등급은 결제 버튼 대신 '이용 중'으로 보여준다", () => {
    render(<PricingPlans currentGrade="basic" subscriptionStatus="active" />);

    expect(screen.getByText("이용 중")).toBeInTheDocument();
    // 기본을 쓰는 중이면 올릴 수 있는 곳은 프로 하나뿐이다
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /프로로 올리기/ })).toBeInTheDocument();
  });

  it("결제하기를 누르면 Stripe 결제창으로 보낸다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_1" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const redirectTo = vi.fn();

    render(
      <PricingPlans currentGrade="trial" subscriptionStatus="none" redirectTo={redirectTo} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /기본으로 시작/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "basic" }),
      }),
    );
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_1"),
    );
  });

  it("프로를 고르면 pro 요금제로 결제를 시작한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_2" })));
    vi.stubGlobal("fetch", fetchMock);

    render(<PricingPlans currentGrade="trial" subscriptionStatus="none" redirectTo={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /프로로 시작/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ plan: "pro" })),
    );
  });

  it("결제 준비가 실패하면 화면에 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "서버에 결제 설정이 되어 있지 않습니다." }), {
            status: 500,
          }),
        ),
    );

    render(<PricingPlans currentGrade="trial" subscriptionStatus="none" redirectTo={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /기본으로 시작/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("결제 설정이 되어 있지 않습니다"),
    );
  });

  it("누르는 동안에는 두 번 눌리지 않게 막는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(<PricingPlans currentGrade="trial" subscriptionStatus="none" redirectTo={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /기본으로 시작/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /준비 중/ })).toBeDisabled());
  });

  it("해지한 사람에게는 다시 구독하도록 안내한다", () => {
    render(<PricingPlans currentGrade="trial" subscriptionStatus="canceled" />);

    expect(screen.getByRole("button", { name: /기본으로 다시 시작/ })).toBeInTheDocument();
  });
});
