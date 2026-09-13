import { describe, expect, it } from "vitest";
import {
  SDVC_BLOCKS,
  FIRST_BLOCK,
  advanceBlock,
  getBlock,
  isBlockId,
  nextBlockId,
  resolveBlock,
  type BlockId,
} from "@/lib/sdvc/blocks";

/**
 * [P3-3] 진행대본(00-guided-session-script.md)의 5블록·7단계 구조가
 * 코드로 그대로 옮겨졌는지 검증한다. 대본이 바뀌면 이 테스트가 먼저 깨져야 한다.
 */

describe("[P3-3] SDVC 블록 정의", () => {
  it("대화 블록이 대본 순서대로 정의돼 있다 (+[P7-4b] 유지보수)", () => {
    expect(SDVC_BLOCKS.map((b) => b.id)).toEqual([
      "constitution_specify",
      "clarify",
      "plan",
      "tasks",
      "implement",
      "maintenance",
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

  it("구현 다음은 유지보수이고, 유지보수에서는 더 나아가지 않는다", () => {
    expect(nextBlockId("implement")).toBe<BlockId>("maintenance");
    expect(nextBlockId("maintenance")).toBeNull();
    expect(advanceBlock("maintenance", { approved: true })).toBe("maintenance");
  });
});

/**
 * [P7-4b] 유지보수 블록 (FR-029, BL-001).
 *
 * 구현을 마친 대화가 `done`이 되어 **모든 입력이 막혔다** — 사용자가 "이어서 수정"에
 * 들어가면 "대화가 끝났습니다"만 뜨고 아무것도 요청할 수 없었다.
 * 진입점(FR-025)은 있는데 정작 쓸 수가 없었던 것이다.
 */
describe("[P7-4b] 유지보수 블록", () => {
  it("구현을 마치면 끝나지 않고 유지보수로 넘어간다", () => {
    expect(advanceBlock("implement", { approved: true })).toBe<BlockId>("maintenance");
  });

  it("유지보수 블록은 승인 게이트가 없고 6번이다", () => {
    const block = getBlock("maintenance");
    expect(block.number).toBe(6);
    expect(block.requiresApproval).toBe(false);
  });

  it("유지보수는 7단계 중 하나가 아니다 — 대본의 7단계를 늘리지 않는다", () => {
    expect(getBlock("maintenance").steps).toEqual([]);
  });

  it("유지보수 지시는 '고칠 파일만'과 '재현 먼저'를 담는다", () => {
    const instruction = getBlock("maintenance").instruction;
    expect(instruction).toContain("고칠 파일만");
    expect(instruction).toContain("재현");
    // 헌장부터 다시 묻게 하면 유지보수가 아니라 새 프로젝트가 된다
    expect(instruction).toContain("헌장부터 다시 묻지 않는다");
  });

  it("예전에 done으로 굳어버린 대화도 유지보수로 읽는다 (DB는 건드리지 않는다)", () => {
    // 이미 done이 된 대화가 DB에 남아 있다. 값을 고치는 마이그레이션 대신
    // 읽는 쪽에서 유지보수로 취급해 다시 열어준다.
    expect(resolveBlock("done")).toBe<BlockId>("maintenance");
    expect(resolveBlock("implement")).toBe<BlockId>("implement");
    expect(advanceBlock("done", { approved: true })).toBe<BlockId>("maintenance");
  });
});

/**
 * [P7-13] PWA(설치형 웹앱) 안내 — 구현(5)·유지보수(6) 공통.
 *
 * 산출물은 정적 파일뿐이라 "네이티브 앱"은 만들 수 없지만, 매니페스트와
 * 서비스 워커는 이미 허용된 확장자(webmanifest·js)만으로 만들 수 있다.
 * 요청 없이 먼저 만들면 안 된다 — 소개 페이지 대부분은 필요 없다.
 */
describe("[P7-13] PWA 안내", () => {
  it("구현 블록 지시에 PWA 파일 형식과 '요청했을 때만'이 담긴다", () => {
    const instruction = getBlock("implement").instruction;
    expect(instruction).toContain("manifest.webmanifest");
    expect(instruction).toContain("sw.js");
    expect(instruction).toContain("요청이 있을 때만");
  });

  it("유지보수 블록 지시에도 같은 안내가 담긴다 (이미 만든 프로젝트에도 나중에 추가 요청 가능)", () => {
    const instruction = getBlock("maintenance").instruction;
    expect(instruction).toContain("manifest.webmanifest");
    expect(instruction).toContain("sw.js");
  });

  it("네이티브 앱이 되는 것은 아니라는 사실을 정확히 안내한다", () => {
    expect(getBlock("implement").instruction).toContain("네이티브 앱");
    expect(getBlock("maintenance").instruction).toContain("네이티브 앱");
  });

  it("아이콘은 SVG로만 만들 수 있다는 한계를 밝힌다 (PNG 등 그림 파일을 직접 만들 수 없다)", () => {
    expect(getBlock("implement").instruction).toContain("SVG로만");
  });
});
