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
