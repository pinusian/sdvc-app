import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    grantedGrade: null,
    grantedUntil: null,
    grantedReason: null,
    monthlyTokenLimit: null,
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
    grantedGrade: null,
    grantedUntil: null,
    grantedReason: null,
    monthlyTokenLimit: null,
  },
];

const ALL_PROJECTS = [
  {
    id: "proj-1",
    ownerEmail: "heavy@x.com",
    name: "소금빵 가게",
    slug: "sogeumppang",
    status: "deployed",
    visibility: "private",
    createdAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "proj-2",
    ownerEmail: "bad@x.com",
    name: "만드는 중인 것",
    slug: "wip-site",
    status: "building",
    visibility: "private",
    createdAt: "2026-09-11T00:00:00.000Z",
  },
];

/**
 * [P8-13] 전체 프로젝트 열람표 (FR-045).
 *
 * "운영자(최고관리자)는 개발자들이 만든 모든 프로젝트를 유지보수 차원에서
 * 볼 수 있으면 좋겠다"는 요청 그대로 — 개발자 관리 표 **아래**에 둔다.
 */
describe("[P8-13] 전체 프로젝트 열람표", () => {
  it("개발자 관리 표 아래에 개발자·프로젝트명·제작일·제작단계·바로보기를 보여준다", () => {
    render(
      <AdminConsole summary={SUMMARY} developers={DEVELOPERS} allProjects={ALL_PROJECTS} />,
    );

    const table = screen.getByRole("table", { name: "전체 프로젝트" });
    const developerHeading = screen.getByRole("heading", { name: /개발자 2명/ });
    // 개발자 관리 표보다 아래(문서 순서상 뒤)에 있어야 한다
    expect(
      developerHeading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const row = screen.getByRole("row", { name: /소금빵 가게/ });
    expect(row).toHaveTextContent("heavy@x.com");
    expect(row).toHaveTextContent("2026-09-10");
    expect(row).toHaveTextContent("완성");
  });

  it("제작 단계는 개발자 화면과 같은 말로 보여준다", () => {
    render(
      <AdminConsole summary={SUMMARY} developers={DEVELOPERS} allProjects={ALL_PROJECTS} />,
    );

    const wip = screen.getByRole("row", { name: /만드는 중인 것/ });
    expect(wip).toHaveTextContent("만드는 중");
  });

  it("완성된 프로젝트만 바로보기가 있다 — 만들다 만 것은 볼 파일이 없다", () => {
    render(
      <AdminConsole summary={SUMMARY} developers={DEVELOPERS} allProjects={ALL_PROJECTS} />,
    );

    const done = screen.getByRole("row", { name: /소금빵 가게/ });
    expect(
      within(done).getByRole("link", { name: /바로보기/ }),
    ).toHaveAttribute("href", "/site/sogeumppang");

    const wip = screen.getByRole("row", { name: /만드는 중인 것/ });
    expect(within(wip).queryByRole("link", { name: /바로보기/ })).toBeNull();
  });

  it("바로보기는 새 탭으로 연다 — 관리자가 자기 작업 화면을 잃지 않는다", () => {
    render(
      <AdminConsole summary={SUMMARY} developers={DEVELOPERS} allProjects={ALL_PROJECTS} />,
    );

    const link = screen.getByRole("link", { name: /바로보기/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("프로젝트가 없으면 그 사실을 분명히 말한다", () => {
    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} allProjects={[]} />);
    expect(screen.getByText(/프로젝트가 없습니다/)).toBeInTheDocument();
  });

  it("최고관리자가 아니면(전달받지 않으면) 표 자체를 그리지 않는다", () => {
    render(<AdminConsole summary={SUMMARY} developers={DEVELOPERS} />);
    expect(screen.queryByRole("table", { name: "전체 프로젝트" })).toBeNull();
  });
});

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

/**
 * [P8-2c] 교육용 운영 조작 (FR-035·036).
 *
 * 수강생에게 등급을 주고, 폭주하는 한 명만 조인다.
 */
describe("[P8-2c] 등급 부여와 한도", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  const withGrant = [
    {
      ...DEVELOPERS[0],
      grantedGrade: "basic",
      grantedUntil: "2026-12-31T00:00:00.000Z",
      grantedReason: "가을 강의",
      monthlyTokenLimit: 300000,
    },
    { ...DEVELOPERS[1], grantedGrade: null, grantedUntil: null, grantedReason: null, monthlyTokenLimit: null },
  ];

  function mockOk(body: Record<string, unknown> = {}) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("부여받은 등급과 기간을 보여준다", () => {
    render(<AdminConsole summary={SUMMARY} developers={withGrant} />);

    expect(screen.getByText(/부여: 기본/)).toBeInTheDocument();
    expect(screen.getByText(/가을 강의/)).toBeInTheDocument();
  });

  it("지정된 한도를 보여준다 (등급 기본값과 구별되게)", () => {
    render(<AdminConsole summary={SUMMARY} developers={withGrant} />);

    expect(screen.getByText(/한도 30만/)).toBeInTheDocument();
  });

  it("등급을 기간과 함께 부여한다", async () => {
    const fetchMock = mockOk({ granted: { grade: "basic" } });
    render(<AdminConsole summary={SUMMARY} developers={withGrant} />);

    await userEvent.click(screen.getByRole("button", { name: /bad@x.com 등급 부여/ }));
    await userEvent.selectOptions(screen.getByLabelText("부여할 등급"), "pro");
    await userEvent.type(screen.getByLabelText("언제까지"), "2026-12-31");
    await userEvent.click(screen.getByRole("button", { name: "부여합니다" }));

    await waitFor(() => {
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toMatchObject({ userId: "b", action: "grant_grade", grade: "pro" });
      expect(body.until).toContain("2026-12-31");
    });
  });

  it("부여를 해제할 수 있다", async () => {
    const fetchMock = mockOk({ granted: null });
    render(<AdminConsole summary={SUMMARY} developers={withGrant} />);

    await userEvent.click(screen.getByRole("button", { name: /heavy@x.com 부여 해제/ }));

    await waitFor(() => {
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ userId: "a", action: "grant_grade" });
    });
  });

  it("한도를 바꾼다", async () => {
    const fetchMock = mockOk({ monthlyTokenLimit: 500000 });
    render(<AdminConsole summary={SUMMARY} developers={withGrant} />);

    await userEvent.click(screen.getByRole("button", { name: /bad@x.com 한도/ }));
    await userEvent.type(screen.getByLabelText("월 토큰 한도"), "500000");
    await userEvent.click(screen.getByRole("button", { name: "한도 저장" }));

    await waitFor(() =>
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        userId: "b",
        action: "set_limit",
        limit: 500000,
      }),
    );
  });

  it("한도를 비우면 null로 보낸다 (등급 기본값으로 되돌리기)", async () => {
    const fetchMock = mockOk({ monthlyTokenLimit: null });
    render(<AdminConsole summary={SUMMARY} developers={withGrant} />);

    await userEvent.click(screen.getByRole("button", { name: /heavy@x.com 한도/ }));
    await userEvent.clear(screen.getByLabelText("월 토큰 한도"));
    await userEvent.click(screen.getByRole("button", { name: "한도 저장" }));

    await waitFor(() =>
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).limit).toBeNull(),
    );
  });
});
