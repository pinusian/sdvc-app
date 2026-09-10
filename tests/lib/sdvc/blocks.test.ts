import { describe, expect, it } from "vitest";
import {
  SDVC_BLOCKS,
  FIRST_BLOCK,
  advanceBlock,
  getBlock,
  isBlockId,
  nextBlockId,
  type BlockId,
} from "@/lib/sdvc/blocks";

/**
 * [P3-3] 진행대본(00-guided-session-script.md)의 5블록·7단계 구조가
 * 코드로 그대로 옮겨졌는지 검증한다. 대본이 바뀌면 이 테스트가 먼저 깨져야 한다.
 */

describe("[P3-3] SDVC 블록 정의", () => {
  it("대화 블록 5개가 대본 순서대로 정의돼 있다", () => {
    expect(SDVC_BLOCKS.map((b) => b.id)).toEqual([
      "constitution_specify",
      "clarify",
      "plan",
      "tasks",
      "implement",
    ]);
    expect(FIRST_BLOCK).toBe("constitution_specify");
  });

  it("7단계(Constitution~Implement)가 빠짐없이 블록에 배치돼 있다", () => {
    const steps = SDVC_BLOCKS.flatMap((b) => b.steps);
    expect(steps).toEqual([
      "Constitution",
      "Specify",
      "Clarify",
      "Plan",
      "Tasks",
      "Analyze",
      "Implement",
    ]);
  });

  it("승인 게이트는 Plan과 Tasks 뒤에만 있다", () => {
    const gated = SDVC_BLOCKS.filter((b) => b.requiresApproval).map((b) => b.id);
    expect(gated).toEqual(["plan", "tasks"]);
  });

  it("각 블록은 산출 문서를 명시한다", () => {
    expect(getBlock("constitution_specify").produces).toEqual([
      "docs/constitution.md",
      "docs/spec.md",
    ]);
    expect(getBlock("plan").produces).toEqual(["docs/plan.md"]);
    expect(getBlock("tasks").produces).toEqual(["docs/tasks.md"]);
  });

  it("isBlockId는 모르는 값을 거부한다", () => {
    expect(isBlockId("plan")).toBe(true);
    expect(isBlockId("done")).toBe(true);
    expect(isBlockId("implement_everything")).toBe(false);
    expect(isBlockId(null)).toBe(false);
  });
});

describe("[P3-3] 블록 진행 규칙", () => {
  it("게이트가 없는 블록은 그냥 다음 블록으로 넘어간다", () => {
    expect(advanceBlock("constitution_specify", { approved: false })).toBe("clarify");
    expect(advanceBlock("clarify", { approved: false })).toBe("plan");
  });

  it("게이트 블록은 승인이 없으면 넘어가지 않는다 (fail-closed)", () => {
    expect(advanceBlock("plan", { approved: false })).toBe("plan");
    expect(advanceBlock("tasks", { approved: false })).toBe("tasks");
  });

  it("게이트 블록은 명시적 승인이 있어야 넘어간다", () => {
    expect(advanceBlock("plan", { approved: true })).toBe("tasks");
    expect(advanceBlock("tasks", { approved: true })).toBe("implement");
  });

  it("마지막 블록 다음은 done이고, done에서는 더 나아가지 않는다", () => {
    expect(nextBlockId("implement")).toBe<BlockId>("done");
    expect(advanceBlock("done", { approved: true })).toBe("done");
    expect(nextBlockId("done")).toBeNull();
  });
});
