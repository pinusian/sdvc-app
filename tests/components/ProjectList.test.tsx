import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectList } from "@/components/projects/ProjectList";

/**
 * [P4-4] 대시보드의 내 프로젝트 목록.
 * 삭제(FR-022)는 되돌릴 수 없으므로 한 번 더 확인을 받는다.
 */

const PROJECTS = [
  {
    id: "proj-1",
    name: "내 개인 홈페이지",
    slug: "site-ab12cd",
    visibility: "private" as const,
    status: "deployed" as const,
  },
  {
    id: "proj-2",
    name: "만들다 만 것",
    slug: "half-done",
    visibility: "private" as const,
    status: "draft" as const,
  },
];

describe("[P4-4] ProjectList", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("프로젝트가 없으면 안내 문구를 보여준다", () => {
    render(<ProjectList projects={[]} />);
    expect(screen.getByText(/아직 만든 프로젝트가 없어요/)).toBeInTheDocument();
  });

  it("이름·주소·상태를 보여주고 완성된 것만 열어볼 수 있다", () => {
    render(<ProjectList projects={PROJECTS} />);

    expect(screen.getByText("내 개인 홈페이지")).toBeInTheDocument();
    expect(screen.getByText("/site/site-ab12cd")).toBeInTheDocument();
    expect(screen.getByText("완성")).toBeInTheDocument();
    expect(screen.getByText("작성 중")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: /열어보기/ });
    expect(links).toHaveLength(1); // 아직 만들다 만 것은 열어보기 링크가 없다
    expect(links[0]).toHaveAttribute("href", "/site/site-ab12cd");
  });

  it("삭제는 한 번 더 확인받는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectList projects={PROJECTS} />);
    await userEvent.click(screen.getAllByRole("button", { name: "삭제" })[0]);

    expect(screen.getByText(/정말 지울까요/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "아니요" }));
    expect(screen.queryByText(/정말 지울까요/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("확인하면 삭제 API를 부르고 목록에서 사라진다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ deleted: true, fileCount: 3 })));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectList projects={PROJECTS} />);
    await userEvent.click(screen.getAllByRole("button", { name: "삭제" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "네, 지울게요" }));

    await waitFor(() =>
      expect(screen.queryByText("내 개인 홈페이지")).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj-1", { method: "DELETE" });
    expect(screen.getByText("만들다 만 것")).toBeInTheDocument();
  });

  it("삭제가 실패하면 목록에서 지우지 않고 오류를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "파일 삭제에 실패했습니다." }), { status: 500 }),
      ),
    );

    render(<ProjectList projects={PROJECTS} />);
    await userEvent.click(screen.getAllByRole("button", { name: "삭제" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "네, 지울게요" }));

    await waitFor(() =>
      expect(screen.getByText(/파일 삭제에 실패했습니다/)).toBeInTheDocument(),
    );
    expect(screen.getByText("내 개인 홈페이지")).toBeInTheDocument();
  });
});

describe("[P5-3] ProjectList — 공개범위 바꾸기", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("지금 공개범위를 고를 수 있게 보여준다", () => {
    render(<ProjectList projects={PROJECTS} />);

    const select = screen.getAllByLabelText("공개범위")[0];
    expect(select).toHaveValue("private");
    expect(screen.getAllByRole("option", { name: /비공개/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: /링크를 아는 사람만/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: /누구나/ }).length).toBeGreaterThan(0);
  });

  it("바꾸면 API를 부르고 화면 표시도 바뀐다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ visibility: "link" })));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectList projects={PROJECTS} />);
    await userEvent.selectOptions(screen.getAllByLabelText("공개범위")[0], "link");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj-1/visibility", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "link" }),
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByLabelText("공개범위")[0]).toHaveValue("link"),
    );
  });

  it("공개하면 남에게 줄 주소를 복사할 수 있게 해준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ visibility: "link" }))),
    );

    render(<ProjectList projects={PROJECTS} />);
    // 비공개일 때는 남에게 줄 주소가 없다
    expect(screen.queryByRole("button", { name: /주소 복사/ })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getAllByLabelText("공개범위")[0], "link");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /주소 복사/ })).toBeInTheDocument(),
    );
  });

  it("실패하면 원래 값으로 되돌리고 오류를 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "바꾸지 못했습니다." }), { status: 500 }),
      ),
    );

    render(<ProjectList projects={PROJECTS} />);
    await userEvent.selectOptions(screen.getAllByLabelText("공개범위")[0], "public");

    await waitFor(() => expect(screen.getByText(/바꾸지 못했습니다/)).toBeInTheDocument());
    expect(screen.getAllByLabelText("공개범위")[0]).toHaveValue("private");
  });
});

describe("[P5-4b] ProjectList — 이어서 수정 진입점 (FR-025)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("그 프로젝트를 만든 대화가 있으면 이어서 수정하러 갈 수 있다", () => {
    render(
      <ProjectList
        projects={[{ ...PROJECTS[0], conversationId: "conv-1" }]}
      />,
    );

    const link = screen.getByRole("link", { name: /이어서 수정/ });
    expect(link).toHaveAttribute("href", "/conversations/conv-1");
  });

  it("연결된 대화가 없으면 그 버튼을 보여주지 않는다", () => {
    render(<ProjectList projects={PROJECTS} />);
    expect(screen.queryByRole("link", { name: /이어서 수정/ })).not.toBeInTheDocument();
  });
});

/**
 * [P7-1b] 만든 뒤에도 이름을 바꿀 수 있다 (FR-030, BL-002).
 */
describe("[P7-1b] 프로젝트 이름 바꾸기", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("이름 바꾸기를 누르면 입력칸이 나오고 저장하면 반영된다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ name: "소금빵 가게" })));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "이름 바꾸기" })[0]);
    const input = screen.getByLabelText("프로젝트 이름");
    await userEvent.clear(input);
    await userEvent.type(input, "소금빵 가게");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "소금빵 가게" }),
      }),
    );
    await waitFor(() => expect(screen.getByText("소금빵 가게")).toBeInTheDocument());
  });

  it("취소하면 원래 이름 그대로다", async () => {
    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "이름 바꾸기" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.getByText("내 개인 홈페이지")).toBeInTheDocument();
    expect(screen.queryByLabelText("프로젝트 이름")).not.toBeInTheDocument();
  });

  it("저장이 실패하면 원래 이름으로 되돌리고 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "이름을 바꾸지 못했습니다." }), { status: 500 }),
        ),
    );

    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "이름 바꾸기" })[0]);
    const input = screen.getByLabelText("프로젝트 이름");
    await userEvent.clear(input);
    await userEvent.type(input, "바뀔 뻔한 이름");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("이름을 바꾸지 못했습니다"),
    );
    expect(screen.getByText("내 개인 홈페이지")).toBeInTheDocument();
  });

  it("빈 이름으로는 저장 버튼이 눌리지 않는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "이름 바꾸기" })[0]);
    await userEvent.clear(screen.getByLabelText("프로젝트 이름"));

    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * [P7-6d] 되돌리기 화면 (FR-012).
 *
 * 되돌리기는 지금 화면을 통째로 바꾼다 — 삭제만큼은 아니어도
 * 한 번 더 확인을 받는다.
 */
describe("[P7-6d] 되돌리기", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  function mockVersions() {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/rollback") && init?.method === "POST") {
        return new Response(JSON.stringify({ version: "0001", fileCount: 2, removedCount: 1 }));
      }
      if (String(url).includes("/rollback")) {
        return new Response(
          JSON.stringify({
            versions: [
              { name: "0002", at: "2026-09-12T11:00:00.000Z", request: "제목 크게" },
              { name: "0001", at: "2026-09-12T10:00:00.000Z", request: "빵집 만들어줘" },
            ],
          }),
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("되돌리기를 누르면 버전 목록을 보여준다", async () => {
    mockVersions();
    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "되돌리기" })[0]);

    await waitFor(() => expect(screen.getByText(/제목 크게/)).toBeInTheDocument());
    expect(screen.getByText(/빵집 만들어줘/)).toBeInTheDocument();
  });

  it("완성되지 않은 프로젝트에는 되돌리기가 없다", () => {
    render(<ProjectList projects={PROJECTS} />);
    // PROJECTS[1]은 draft 상태다
    expect(screen.getAllByRole("button", { name: "되돌리기" })).toHaveLength(1);
  });

  it("고르면 한 번 더 확인받고 되돌린다", async () => {
    const fetchMock = mockVersions();
    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "되돌리기" })[0]);
    await waitFor(() => expect(screen.getByText(/빵집 만들어줘/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /빵집 만들어줘.*으로 되돌리기/ }));
    // 바로 되돌리지 않는다
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === "POST")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "네, 되돌립니다" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj-1/rollback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "0001" }),
      }),
    );
  });

  it("되돌린 뒤 결과를 알려준다", async () => {
    mockVersions();
    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "되돌리기" })[0]);
    await waitFor(() => expect(screen.getByText(/빵집 만들어줘/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /빵집 만들어줘.*으로 되돌리기/ }));
    await userEvent.click(screen.getByRole("button", { name: "네, 되돌립니다" }));

    await waitFor(() => expect(screen.getByText(/되돌렸습니다/)).toBeInTheDocument());
  });

  it("보관된 버전이 없으면 그렇게 알려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ versions: [] }))),
    );
    render(<ProjectList projects={PROJECTS} />);

    await userEvent.click(screen.getAllByRole("button", { name: "되돌리기" })[0]);

    await waitFor(() => expect(screen.getByText(/되돌릴 수 있는 시점이 없어요/)).toBeInTheDocument());
  });
});
