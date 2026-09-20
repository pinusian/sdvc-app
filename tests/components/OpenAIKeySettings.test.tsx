import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenAIKeySettings } from "@/components/settings/OpenAIKeySettings";

const EMPTY = { configured: false, maskedKey: null, keyVersion: null, updatedAt: null };
const CONFIGURED = {
  configured: true,
  maskedKey: "••••7890",
  keyVersion: "v1",
  updatedAt: "2026-09-20T06:00:00.000Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("[T025] OpenAIKeySettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("등록 상태는 마스킹만 보여주고 비용·보안 책임을 안내한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(CONFIGURED)));
    render(<OpenAIKeySettings />);

    expect(await screen.findByText("••••7890")).toBeInTheDocument();
    expect(screen.getByText(/OpenAI 계정에 직접 청구/)).toBeInTheDocument();
    expect(screen.getByText(/원문은 저장 후 다시 표시되지/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk-proj");
  });

  it("미등록 상태에서 키를 등록하고 입력값을 화면에서 지운다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(EMPTY))
      .mockResolvedValueOnce(json(CONFIGURED));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OpenAIKeySettings />);

    const input = await screen.findByLabelText("OpenAI API 키");
    await user.type(input, "sk-proj-user-secret-7890");
    await user.click(screen.getByRole("button", { name: "키 등록" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/settings/openai-key",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ apiKey: "sk-proj-user-secret-7890" }),
      }),
    );
    expect(input).toHaveValue("");
    expect(await screen.findByText("••••7890")).toBeInTheDocument();
  });

  it("등록된 키는 같은 입력 폼에서 교체할 수 있다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(CONFIGURED)));
    render(<OpenAIKeySettings />);

    expect(await screen.findByRole("button", { name: "키 교체" })).toBeInTheDocument();
  });

  it("서버 오류를 숨기지 않고 사용자에게 알린다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(EMPTY))
      .mockResolvedValueOnce(json({ error: "OpenAI 자격 암호화 설정이 없습니다." }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OpenAIKeySettings />);

    await user.type(await screen.findByLabelText("OpenAI API 키"), "sk-test-value");
    await user.click(screen.getByRole("button", { name: "키 등록" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("암호화 설정이 없습니다");
  });

  it("삭제는 명시적 2단계 확인 뒤 실행하고 미등록 상태로 바꾼다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(CONFIGURED))
      .mockResolvedValueOnce(json({ ...EMPTY, cancelledRunCount: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OpenAIKeySettings />);

    await user.click(await screen.findByRole("button", { name: "키 삭제" }));
    expect(screen.getByText(/진행 중인 AI 작업도 중단/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제 확인" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/settings/openai-key", { method: "DELETE" }),
    );
    expect(await screen.findByText(/등록된 키가 없습니다/)).toBeInTheDocument();
  });
});
