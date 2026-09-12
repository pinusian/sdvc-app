import { describe, expect, it } from "vitest";
import { suggestProjectName, normalizeProjectName, MAX_NAME_LENGTH } from "@/lib/projects/name";

/**
 * [P7-1b] 프로젝트 이름 (FR-030, BL-002).
 *
 * 지금은 모든 프로젝트가 "내 프로젝트"라 목록에서 구분이 안 된다.
 * 이름을 안 적은 사람에게는 **첫 대화 내용으로 지어준다** — 모델을 한 번 더
 * 부르지 않는다(돈이 드니까). 규칙 기반이라 틀릴 수 있지만 "내 프로젝트"보다는 낫다.
 */

describe("[P7-1b] suggestProjectName", () => {
  it("첫 요청에서 만들려는 것을 뽑아낸다", () => {
    expect(suggestProjectName("빵집 홈페이지 만들고 싶어")).toBe("빵집 홈페이지");
    expect(suggestProjectName("소금빵 가게 홈페이지 만들어줘")).toBe("소금빵 가게 홈페이지");
    expect(suggestProjectName("독서 기록 앱 만들어 주세요")).toBe("독서 기록 앱");
  });

  it("앞의 인사말은 버린다", () => {
    expect(suggestProjectName("안녕하세요. 카페 홈페이지 만들고 싶어요")).toBe("카페 홈페이지");
  });

  it("너무 길면 자른다", () => {
    const name = suggestProjectName(
      "우리 동네에 있는 작은 빵집을 위한 아주 예쁘고 정성스러운 소개 홈페이지를 하나 만들어주세요",
    );
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(name.length).toBeGreaterThan(0);
  });

  it("뽑을 게 없으면 기본 이름으로 둔다", () => {
    expect(suggestProjectName("")).toBe("내 프로젝트");
    expect(suggestProjectName("   ")).toBe("내 프로젝트");
    expect(suggestProjectName("만들어줘")).toBe("내 프로젝트");
  });

  it("줄바꿈이 있어도 첫 줄만 본다", () => {
    expect(suggestProjectName("꽃집 홈페이지 만들어줘\n\n메뉴도 넣고 지도도 넣어줘")).toBe(
      "꽃집 홈페이지",
    );
  });
});

describe("[P7-1b] normalizeProjectName", () => {
  it("앞뒤 공백을 털고 그대로 쓴다", () => {
    expect(normalizeProjectName("  우리 빵집  ")).toBe("우리 빵집");
  });

  it("빈 이름은 거부한다 (null)", () => {
    expect(normalizeProjectName("")).toBeNull();
    expect(normalizeProjectName("   ")).toBeNull();
    expect(normalizeProjectName(123)).toBeNull();
    expect(normalizeProjectName(null)).toBeNull();
  });

  it("너무 긴 이름은 거부한다 — 잘라서 저장하면 사용자가 낸 것과 달라진다", () => {
    expect(normalizeProjectName("가".repeat(MAX_NAME_LENGTH))).toBe("가".repeat(MAX_NAME_LENGTH));
    expect(normalizeProjectName("가".repeat(MAX_NAME_LENGTH + 1))).toBeNull();
  });

  it("줄바꿈은 공백 하나로 눕힌다 (목록이 깨지지 않게)", () => {
    expect(normalizeProjectName("우리\n빵집")).toBe("우리 빵집");
  });
});
