import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunProgressPanel } from "@/components/execution/RunProgressPanel";

const RUN = {
  id: "run-1",
  ownerId: "user-1",
  projectId: "project-1",
  documentBundleHash: "a".repeat(64),
  idempotencyKey: "attempt-1",
  status: "running",
  createdAt: "2026-09-22T01:00:00.000Z",
  updatedAt: "2026-09-22T01:01:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

describe("[T035] 구현 진행 화면", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("새 실행을 만들고 진행 상태와 로그를 표시한다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => jsonResponse({ run: { ...RUN, status: "queued" } }, 201))
      .mockImplementationOnce(() => jsonResponse({
        run: RUN,
        events: [{ id: "event-1", runId: RUN.id, sequence: 1, type: "red_started", payload: { message: "RED 테스트 시작" }, createdAt: RUN.createdAt }],
      }));

    render(<RunProgressPanel projects={[{ id: "project-1", name: "시험 프로젝트" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "구현 실행 준비" }));

    expect(await screen.findByText("실행 중")).toBeInTheDocument();
    expect(screen.getByText("RED 테스트 시작")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ method: "POST" }));
    expect(localStorage.getItem("sdvc:last-run-id")).toBe(RUN.id);
  });

  it("새로고침 뒤 마지막 실행 ID로 DB 상태를 복원한다", async () => {
    localStorage.setItem("sdvc:last-run-id", RUN.id);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse({
      run: RUN,
      events: [{ id: "event-1", runId: RUN.id, sequence: 1, type: "green_passed", payload: {}, createdAt: RUN.createdAt }],
    }));

    render(<RunProgressPanel projects={[{ id: "project-1", name: "시험 프로젝트" }]} />);

    expect(await screen.findByText("GREEN 통과")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/runs/${RUN.id}`, expect.anything());
  });

  it("실행 중에는 취소하고 실패 후에는 새 실행으로 재시도한다", async () => {
    localStorage.setItem("sdvc:last-run-id", RUN.id);
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => jsonResponse({ run: RUN, events: [] }))
      .mockImplementationOnce(() => jsonResponse({ run: { ...RUN, status: "cancel_requested" } }, 202))
      .mockImplementationOnce(() => jsonResponse({ run: { ...RUN, status: "failed" }, events: [] }))
      .mockImplementationOnce(() => jsonResponse({ run: { ...RUN, id: "run-2", status: "queued" } }, 201));

    const { rerender } = render(<RunProgressPanel projects={[{ id: "project-1", name: "시험 프로젝트" }]} />);
    await userEvent.click(await screen.findByRole("button", { name: "실행 취소" }));
    expect(await screen.findByText("취소 요청됨")).toBeInTheDocument();

    localStorage.setItem("sdvc:last-run-id", RUN.id);
    rerender(<RunProgressPanel key="retry" projects={[{ id: "project-1", name: "시험 프로젝트" }]} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("대기 중")).toBeInTheDocument();
    expect(localStorage.getItem("sdvc:last-run-id")).toBe("run-2");
  });
});
