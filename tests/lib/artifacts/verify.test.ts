import { describe, expect, it } from "vitest";
import { claimsChange, describeUnchanged } from "@/lib/artifacts/verify";

/**
 * [P7-12] 고쳤다는 말과 실제로 고쳐졌는가 (SC-008 개정).
 *
 * 이 자리에서 두 번 다쳤다:
 *   BL-001b — 모델은 "고쳤습니다"라고 답했는데 파서가 파일을 조용히 버려
 *             홈페이지가 그대로였다
 *   BL-005b — 이미지는 저장됐는데 HTML이 안 바뀌어 화면에 변화가 없었다
 *
 * 둘 다 **말과 결과가 어긋난** 경우다. 원래 SC-008이 막으려던 것이 이것인데,
 * "재현 테스트(RED) 실행"은 정적 HTML에서 지킬 수 없는 말이라 지켜지지 않고 있었다.
 */

describe("[P7-12] claimsChange — 고쳤다고 말하는가", () => {
  it("고쳤다고 하면 참", () => {
    for (const text of [
      "말씀하신 부분을 고쳤습니다.",
      "버튼 색을 바꿨습니다.",
      "요청하신 기능을 추가했습니다.",
      "해당 문구를 수정하였습니다.",
      "메뉴를 삭제했습니다.",
      "반영했습니다. 확인해보세요.",
    ].map((t) => t.trim())) {
      expect(claimsChange(text), text).toBe(true);
    }
  });

  it("묻거나 설명만 하면 거짓 — 물어보는 중에 경고를 띄우면 시끄럽다", () => {
    for (const text of [
      "어떤 색으로 바꿀까요?",
      "지금 화면은 이렇게 되어 있습니다.",
      "혹시 어느 부분을 말씀하시는 걸까요?",
      "그 기능은 정적 페이지에서는 어렵습니다. 대신 이런 방법이 있습니다.",
    ]) {
      expect(claimsChange(text), text).toBe(false);
    }
  });

  it("빈 답에는 아무 주장도 없다", () => {
    expect(claimsChange("")).toBe(false);
    expect(claimsChange("   ")).toBe(false);
  });

  it("고치겠다는 **예고**는 주장이 아니다 — 아직 안 한 것이다", () => {
    expect(claimsChange("이제 고치겠습니다. 잠시만요.")).toBe(false);
    expect(claimsChange("바꿔드릴게요.")).toBe(false);
  });
});

describe("[P7-12] describeUnchanged — 무엇이 그대로인가", () => {
  it("전부 그대로면 그 사실을 분명히 말한다", () => {
    const warning = describeUnchanged(["index.html"], ["index.html"]);
    expect(warning).not.toBeNull();
    expect(warning).toContain("index.html");
    expect(warning).toMatch(/바뀐 것이 없|그대로/);
  });

  it("일부만 그대로면 그 파일만 짚는다", () => {
    const warning = describeUnchanged(["index.html", "style.css"], ["style.css"]);
    expect(warning).toContain("style.css");
    expect(warning).not.toContain("index.html");
  });

  it("다 바뀌었으면 아무 말도 하지 않는다 — 잘 된 일에 경고를 붙이지 않는다", () => {
    expect(describeUnchanged(["index.html"], [])).toBeNull();
  });

  it("낸 파일이 없으면 여기서 다룰 일이 아니다", () => {
    expect(describeUnchanged([], [])).toBeNull();
  });

  it("파일이 많으면 줄여 말한다 — 경고가 화면을 덮으면 아무도 안 읽는다", () => {
    const many = Array.from({ length: 9 }, (_, i) => `p${i}.html`);
    const warning = describeUnchanged(many, many);
    expect(warning).toContain("9개");
    expect((warning ?? "").length).toBeLessThan(200);
  });
});
