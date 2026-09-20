import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentPanel } from "@/components/chat/DocumentPanel";

const view = {
  currentStage: "plan" as const,
  documents: [
    {
      kind: "plan" as const,
      approvedVersionId: null,
      versions: [
        {
          id: "plan-v2",
          projectId: "project-1",
          kind: "plan" as const,
          version: 2,
          content: "두 번째 계획 내용",
          contentHash: "hash-v2",
          createdAt: "2026-09-20T09:00:00.000Z",
        },
        {
          id: "plan-v1",
          projectId: "project-1",
          kind: "plan" as const,
          version: 1,
          content: "첫 계획 내용",
          contentHash: "hash-v1",
          createdAt: "2026-09-20T08:00:00.000Z",
        },
      ],
    },
  ],
};

describe("[T030] 문서 버전·승인 패널", () => {
  it("최신 문서와 버전 선택기를 보여준다", async () => {
    render(<DocumentPanel kind="plan" view={view} busy={false} onApprove={vi.fn()} />);

    expect(screen.getByText("두 번째 계획 내용")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("계획 버전"), "plan-v1");
    expect(screen.getByText("첫 계획 내용")).toBeInTheDocument();
  });

  it("최신 버전만 승인 대상으로 전달한다", async () => {
    const onApprove = vi.fn();
    render(<DocumentPanel kind="plan" view={view} busy={false} onApprove={onApprove} />);

    await userEvent.click(screen.getByRole("button", { name: "계획 v2 승인" }));
    expect(onApprove).toHaveBeenCalledWith("plan-v2");
  });

  it("이전 버전을 보고 있을 때는 승인 버튼을 비활성화한다", async () => {
    render(<DocumentPanel kind="plan" view={view} busy={false} onApprove={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText("계획 버전"), "plan-v1");
    expect(screen.getByRole("button", { name: /최신 버전만 승인/ })).toBeDisabled();
  });
});
