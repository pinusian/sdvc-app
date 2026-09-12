import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewConversationButton } from "@/components/chat/NewConversationButton";

/**
 * [P7-1b] 새 프로젝트를 만들 때 이름을 정할 수 있다 (FR-030, BL-002).
 *
 * **비워도 시작할 수 있어야 한다** — 무엇을 만들지 아직 모르는 사람에게
 * 이름부터 물으면 첫 관문이 된다(Clarify 10).
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("[P7-1b] NewConversationButton", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  function mockCreate() {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "conv-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("이름을 적어 시작하면 그 이름으로 만든다", async () => {
    const fetchMock = mockCreate();
    render(<NewConversationButton />);

    await userEvent.click(screen.getByRole("button", { name: /새 프로젝트/ }));
    await userEvent.type(screen.getByLabelText("프로젝트 이름"), "소금빵 가게");
    await userEvent.click(screen.getByRole("button", { name: "시작하기" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ title: "소금빵 가게" })),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/conversations/conv-1"));
  });

  it("이름을 비워도 시작할 수 있다", async () => {
    const fetchMock = mockCreate();
    render(<NewConversationButton />);

    await userEvent.click(screen.getByRole("button", { name: /새 프로젝트/ }));
    await userEvent.click(screen.getByRole("button", { name: "시작하기" }));

    await waitFor(() => expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({})));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/conversations/conv-1"));
  });

  it("비워도 된다고 화면에 알려준다", async () => {
    mockCreate();
    render(<NewConversationButton />);

    await userEvent.click(screen.getByRole("button", { name: /새 프로젝트/ }));

    expect(screen.getByText(/비워두면/)).toBeInTheDocument();
  });

  it("실패하면 알리고 다시 시도할 수 있다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "대화를 시작하지 못했습니다." }), { status: 500 }),
        ),
    );
    render(<NewConversationButton />);

    await userEvent.click(screen.getByRole("button", { name: /새 프로젝트/ }));
    await userEvent.click(screen.getByRole("button", { name: "시작하기" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("대화를 시작하지 못했습니다"),
    );
    expect(screen.getByRole("button", { name: "시작하기" })).toBeEnabled();
  });
});
