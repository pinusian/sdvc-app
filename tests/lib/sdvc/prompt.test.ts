import { describe, expect, it, afterEach } from "vitest";
import {
  buildSystemPrompt,
  parseGateMarker,
  splitPendingMarker,
  stripGateMarker,
  GATE_MARKER_PATTERN,
} from "@/lib/sdvc/prompt";

/**
 * [P3-3] 진행대본의 "전체를 관통하는 규칙"이 시스템 프롬프트에 실제로
 * 담기는지 검증한다. Claude Code에서 사람이 대본을 읽고 지키던 것을
 * 서버 프롬프트로 옮기는 작업이므로, 규칙 누락이 곧 기능 결함이다.
 */

describe("[P3-3] buildSystemPrompt", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("전체 흐름(5블록 7단계)과 현재 블록을 함께 알려준다", () => {
    const prompt = buildSystemPrompt({ block: "clarify" });

    expect(prompt).toContain("Constitution");
    expect(prompt).toContain("Implement");
    expect(prompt).toContain("현재 블록");
    expect(prompt).toContain("블록 2");
    expect(prompt).toContain("Clarify");
  });

  it("블록마다 그 블록의 지시만 '현재 할 일'로 준다", () => {
    const planPrompt = buildSystemPrompt({ block: "plan" });
    expect(planPrompt).toContain("docs/plan.md");
    expect(planPrompt).toContain("현재 블록: 블록 3");

    const tasksPrompt = buildSystemPrompt({ block: "tasks" });
    expect(tasksPrompt).toContain("현재 블록: 블록 4");
    expect(tasksPrompt).toContain("버티컬 슬라이스");
  });

  it("관통 규칙 4가지가 모든 블록의 프롬프트에 들어간다", () => {
    for (const block of ["constitution_specify", "clarify", "plan", "tasks", "implement"] as const) {
      const prompt = buildSystemPrompt({ block });
      expect(prompt, `${block}: 예시 답안 규칙`).toContain("예시 답안");
      expect(prompt, `${block}: 용어 풀이 규칙`).toContain("쉬운 말");
      expect(prompt, `${block}: 증거 기반 보고 규칙`).toContain("실행하지 않은");
      expect(prompt, `${block}: 승인 게이트 규칙`).toContain("승인");
    }
  });

  it("[P4-3] 구현 블록에서는 파일을 정해진 형식으로 내라고 지시한다", () => {
    const prompt = buildSystemPrompt({ block: "implement" });
    expect(prompt).toContain("```file:");
    expect(prompt).toContain("index.html");

    // 설명용 코드블록과 구분해야 하므로, 다른 블록에는 이 지시가 없다.
    expect(buildSystemPrompt({ block: "plan" })).not.toContain("```file:");
  });

  it("헌장의 보안 규칙(키 값을 AI가 채우지 않는다)을 프롬프트에 명시한다", () => {
    const prompt = buildSystemPrompt({ block: "implement" });
    expect(prompt).toContain("API 키");
    expect(prompt).toContain("값을 채우지 않는다");
  });

  it("모든 블록이 끝날 때 마커를 내도록 지시한다", () => {
    // [P3-7] 실제 대화에서 발견: 게이트 블록에만 마커를 지시했더니
    // 헌장·명확화 블록에서 사용자가 "예"라고 해도 다음 블록으로 갈 방법이
    // 없었다. 단계 이동은 마커 → 승인 버튼으로만 일어나므로 모든 블록이
    // 마커를 내야 한다.
    expect(buildSystemPrompt({ block: "constitution_specify" })).toContain(
      "<<SDVC_GATE:constitution_specify>>",
    );
    expect(buildSystemPrompt({ block: "clarify" })).toContain("<<SDVC_GATE:clarify>>");
    expect(buildSystemPrompt({ block: "plan" })).toContain("<<SDVC_GATE:plan>>");
    expect(buildSystemPrompt({ block: "tasks" })).toContain("<<SDVC_GATE:tasks>>");
  });

  it("사용자가 말로 '예'라고 해도 다음 블록 일을 미리 하지 말라고 못박는다", () => {
    // [P3-7] 실제 대화에서 발견: 사용자가 버튼 대신 "예"라고 입력하면
    // 서버의 진행 단계는 그대로인데 모델만 다음 블록 내용을 진행해버려
    // 화면 표시와 실제 상태가 어긋났다.
    const prompt = buildSystemPrompt({ block: "clarify" });
    expect(prompt).toContain("확인 버튼");
    expect(prompt).toMatch(/말로.*예/);
  });

  it("[P4-6] 버튼을 말로 언급하면 반드시 마커를 함께 내라고 못박는다", () => {
    // 사용자 테스트에서 발견: 모델이 "아래 확인 버튼을 눌러주세요"라고
    // 말만 하고 마커를 빼먹어, 화면에 버튼이 없는 채로 안내만 남았다.
    const prompt = buildSystemPrompt({ block: "clarify" });
    expect(prompt).toMatch(/버튼.*언급|언급.*버튼/);
  });

  it("게이트 블록에서는 승인 없이 넘어가지 말라고 더 강하게 못박는다", () => {
    expect(buildSystemPrompt({ block: "plan" })).toContain("승인 없이는");
    expect(buildSystemPrompt({ block: "clarify" })).not.toContain("승인 없이는");
  });

  it("프로젝트 이름이 있으면 프롬프트에 포함한다", () => {
    const prompt = buildSystemPrompt({ block: "plan", projectName: "독서기록 앱" });
    expect(prompt).toContain("독서기록 앱");
  });

  it("서버 비밀값을 프롬프트에 절대 넣지 않는다", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-appear";
    const prompt = buildSystemPrompt({ block: "implement" });
    expect(prompt).not.toContain("sk-ant-should-never-appear");
  });
});

describe("[P3-3] 승인 게이트 마커", () => {
  it("모델 응답에서 게이트 마커를 찾아낸다", () => {
    expect(parseGateMarker("이 계획대로 진행할까요?\n<<SDVC_GATE:plan>>")).toBe("plan");
    expect(parseGateMarker("작업 순서입니다.\n<<SDVC_GATE:tasks>>\n")).toBe("tasks");
  });

  it("마커가 없거나 모르는 블록이면 null을 준다", () => {
    expect(parseGateMarker("그냥 설명입니다.")).toBeNull();
    expect(parseGateMarker("<<SDVC_GATE:모르는블록>>")).toBeNull();
  });

  it("사용자에게 보여줄 때는 마커를 지운다", () => {
    expect(stripGateMarker("계획입니다.\n<<SDVC_GATE:plan>>\n")).toBe("계획입니다.");
    expect(stripGateMarker("마커 없음")).toBe("마커 없음");
  });

  it("스트리밍 중 마커가 잘려 들어와도 화면에 새어나가지 않게 붙들어 둔다", () => {
    // [P3-4] 마커는 한 글자씩 흘러오므로, 마커 시작처럼 보이는 꼬리는
    // 완성될 때까지 내보내지 않는다.
    expect(splitPendingMarker("계획입니다.\n<<SDVC_")).toEqual(["계획입니다.\n", "<<SDVC_"]);
    expect(splitPendingMarker("끝<<SDVC_GATE:plan>>")).toEqual(["끝", "<<SDVC_GATE:plan>>"]);
    expect(splitPendingMarker("계획입니다.")).toEqual(["계획입니다.", ""]);
    // 마커와 무관한 부등호는 그대로 내보낸다.
    expect(splitPendingMarker("a < b 입니다")).toEqual(["a < b 입니다", ""]);
  });

  it("마커 정규식은 전역 플래그 없이 재사용해도 안전하다", () => {
    // 전역 플래그가 붙으면 lastIndex 때문에 두 번째 호출이 실패한다.
    expect(GATE_MARKER_PATTERN.global).toBe(false);
    expect(parseGateMarker("<<SDVC_GATE:plan>>")).toBe("plan");
    expect(parseGateMarker("<<SDVC_GATE:plan>>")).toBe("plan");
  });
});
