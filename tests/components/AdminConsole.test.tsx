import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminConsole } from "@/components/admin/AdminConsole";

/**
 * [P8-2][P8-3] 운영 화면 (FR-014·015, SC-006·007).
 *
 * 한 화면에서 **지금 적자인가**와 **누구를 손봐야 하는가**가 보여야 한다.
 */

const SUMMARY = {
  totalCostUsd: 6,
  totalRevenueUsd: 47,
  marginUsd: 41,
  costRatio: 6 / 47,
  byDeveloper: [
    { id: "a", email: "heavy@x.com", grade: "basic", costUsd: 5, priceUsd: 12, costRatio: 5 / 12 },
  ],
};

const DEVELOPERS = [
  {
    id: "a",
    email: "heavy@x.com",
    role: "developer",
    grade: "basic",
    subscriptionStatus: "active",
    trialEndsAt: null,
    suspendedAt: null,
    suspendedReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "b",
    email: "bad@x.com",
    role: "developer",
    grade: "trial",
    subscriptionStatus: "none",
    trialEndsAt: "2026-09-20T00:00:00.000Z",
    suspendedAt: "2026-09-12T00:00:00.000Z",
    suspendedReason: "불법 콘텐츠",
    createdAt: "2026-09-05T00:00:00.000Z",
  },
];

describe("[P8-2][P8-3] AdminConsole", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("지금 적자인지 한눈에 보여준다", () => {
    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);

    expect(screen.getByText(/\$6/)).toBeInTheDocument();
    expect(screen.getByText(/\$47/)).toBeInTheDocument();
    expect(screen.getByText(/13%/)).toBeInTheDocument(); // 6/47 ≈ 12.8%
  });

  it("원가가 요금을 넘으면 눈에 띄게 알린다", () => {
    render(
      <AdminConsole
        summary={{ ...SUMMARY, totalCostUsd: 60, marginUsd: -13, costRatio: 60 / 47 }}
        developers={DEVELOPERS}
      />,
    );

    expect(screen.getByText(/적자/)).toBeInTheDocument();
  });

  it("개발자 목록에 등급·상태·정지 여부가 보인다", () => {
    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);

    // heavy@x.com은 원가 순위와 목록 두 곳에 나온다 — 목록에 있다는 것만 본다
    expect(screen.getAllByText("heavy@x.com").length).toBeGreaterThan(0);
    expect(screen.getByText("bad@x.com")).toBeInTheDocument();
    expect(screen.getByText(/정지됨/)).toBeInTheDocument();
    expect(screen.getByText(/불법 콘텐츠/)).toBeInTheDocument();
  });

  it("정지하려면 사유를 적어야 한다 (나중에 왜 정지했는지 알아야 한다)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suspended: true })));
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);

    await userEvent.click(screen.getByRole("button", { name: /heavy@x.com 정지/ }));
    expect(screen.getByRole("button", { name: "정지합니다" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("정지 사유"), "약관 위반");
    await userEvent.click(screen.getByRole("button", { name: "정지합니다" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/developers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "a", action: "suspend", reason: "약관 위반" }),
      }),
    );
  });

  it("정지 해제는 사유 없이 바로 된다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suspended: false })));
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);

    await userEvent.click(screen.getByRole("button", { name: /bad@x.com 정지 해제/ }));

    await waitFor(() =>
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("unsuspend"),
    );
  });

  it("체험 연장을 누르면 늘어난 날짜를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ trialEndsAt: "2026-09-27T00:00:00.000Z" })),
        ),
    );

    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);

    await userEvent.click(screen.getByRole("button", { name: /bad@x.com 체험 연장/ }));

    // 가입 날짜에도 2026이 있으므로, 연장 결과 안내 문구로 확인한다
    await waitFor(() => expect(screen.getByText(/늘렸습니다/)).toBeInTheDocument());
  });

  it("감사 로그 경고가 오면 화면에 띄운다 (조용히 넘기지 않는다)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ suspended: false, auditWarning: "감사 로그를 남기지 못했습니다: 권한 없음" }),
        ),
      ),
    );

    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);
    await userEvent.click(screen.getByRole("button", { name: /bad@x.com 정지 해제/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("감사 로그를 남기지 못했습니다"),
    );
  });

  it("실패하면 이유를 그대로 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "이 작업을 할 권한이 없습니다." }), { status: 403 }),
        ),
    );

    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);
    await userEvent.click(screen.getByRole("button", { name: /bad@x.com 정지 해제/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("권한이 없습니다"),
    );
  });
});
