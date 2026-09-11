import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountStatus } from "@/components/billing/AccountStatus";

/**
 * [P6-8] 대시보드의 내 이용 상태.
 *
 * "지금 무슨 등급이고, 언제까지 쓸 수 있고, 이번 달 얼마나 썼는지"를
 * 숫자 그대로가 아니라 사람이 읽는 말로 보여준다.
 */

const BASE = {
  grade: "trial" as const,
  subscriptionStatus: "none" as const,
  trialEndsAt: "2026-09-15T00:00:00.000Z",
  monthlyTokensUsed: 250_000,
  projectCount: 1,
  canManage: false,
  now: new Date("2026-09-12T00:00:00.000Z"),
};

describe("[P6-8] AccountStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("체험 중이면 남은 날짜를 알려준다", () => {
    render(<AccountStatus {...BASE} />);

    expect(screen.getByText(/체험/)).toBeInTheDocument();
    expect(screen.getByText(/3일 남음/)).toBeInTheDocument();
  });

  it("막 가입했으면 7일이라고 한다 — 몇 초 오차로 6일이나 8일이 되면 안 된다", () => {
    // 가입 직후 남은 시간은 7일 경계에 걸린다. DB 시계와 서버 시계가 몇 초
    // 어긋나므로 양쪽 다 7일로 읽혀야 한다.
    for (const endsAt of ["2026-09-19T00:00:02.000Z", "2026-09-18T23:59:58.000Z"]) {
      const { unmount } = render(
        <AccountStatus {...BASE} now={new Date("2026-09-12T00:00:00.000Z")} trialEndsAt={endsAt} />,
      );
      expect(screen.getByText(/체험 7일 남음/), endsAt).toBeInTheDocument();
      unmount();
    }
  });

  it("하루도 안 남았으면 '오늘까지'라고 한다", () => {
    render(<AccountStatus {...BASE} trialEndsAt="2026-09-12T18:00:00.000Z" />);

    expect(screen.getByText(/체험 오늘까지/)).toBeInTheDocument();
  });

  it("체험이 끝났으면 끝났다고 말하고 요금제로 안내한다", () => {
    render(<AccountStatus {...BASE} trialEndsAt="2026-09-10T00:00:00.000Z" />);

    expect(screen.getByText(/체험 기간이 끝났습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /요금제/ })).toHaveAttribute("href", "/pricing");
  });

  it("이번 달 사용량을 한도와 함께 보여준다", () => {
    render(<AccountStatus {...BASE} />);

    // 체험 한도는 50만 토큰 — 25만을 썼으니 절반
    expect(screen.getByText(/25만 \/ 50만 토큰/)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: /사용량/ });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("프로젝트 수도 한도와 함께 보여준다", () => {
    render(<AccountStatus {...BASE} grade="basic" subscriptionStatus="active" projectCount={2} />);

    expect(screen.getByText(/프로젝트 2 \/ 3개/)).toBeInTheDocument();
  });

  it("구독 중이면 구독 관리 버튼으로 Stripe 포털에 보낸다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/1" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const redirectTo = vi.fn();

    render(
      <AccountStatus
        {...BASE}
        grade="basic"
        subscriptionStatus="active"
        canManage
        redirectTo={redirectTo}
      />,
    );

    expect(screen.getByText(/구독 중/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /구독 관리/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/billing/portal", { method: "POST" }),
    );
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith("https://billing.stripe.com/p/session/1"),
    );
  });

  it("결제가 밀렸으면 그대로 알린다", () => {
    render(
      <AccountStatus {...BASE} grade="basic" subscriptionStatus="past_due" canManage />,
    );

    expect(screen.getByText(/결제가 밀려/)).toBeInTheDocument();
  });

  it("포털 열기에 실패하면 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "구독 정보를 찾을 수 없습니다." }), { status: 400 }),
        ),
    );

    render(
      <AccountStatus
        {...BASE}
        grade="basic"
        subscriptionStatus="active"
        canManage
        redirectTo={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /구독 관리/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("구독 정보를 찾을 수 없습니다"),
    );
  });
});
