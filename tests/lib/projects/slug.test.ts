import { describe, expect, it } from "vitest";
import { toSlug, pickUniqueSlug } from "@/lib/projects/slug";

/**
 * [P4-3] 프로젝트 이름 → 주소(slug) 변환.
 *
 * DB가 소문자·숫자·하이픈 3~40자만 받으므로([P4-2] 실검증), 사람이 쓴 이름을
 * 그대로 넣으면 거부된다. 한글 이름이 흔할 것이므로 그 경우까지 다뤄야 한다.
 */

describe("[P4-3] toSlug", () => {
  it("영문 이름은 소문자 하이픈 형태로 바꾼다", () => {
    expect(toSlug("My Personal Homepage")).toBe("my-personal-homepage");
    expect(toSlug("Portfolio  2026!!")).toBe("portfolio-2026");
  });

  it("한글만 있는 이름은 쓸 수 있는 기본 주소로 바꾼다", () => {
    // 한글은 주소로 못 쓰므로 이름에서 뽑을 수 없다 — 기본값 + 무작위 꼬리.
    const slug = toSlug("내 개인 홈페이지");
    expect(slug).toMatch(/^site-[a-z0-9]+$/);
  });

  it("한글과 영문이 섞이면 영문·숫자 부분을 살린다", () => {
    expect(toSlug("내 blog 2026")).toBe("blog-2026");
  });

  it("DB 제약(3~40자, 앞뒤 하이픈 없음)을 항상 지킨다", () => {
    expect(toSlug("ab")).toMatch(/^ab[a-z0-9-]+$/); // 너무 짧으면 늘린다
    expect(toSlug("a".repeat(60)).length).toBeLessThanOrEqual(40);
    expect(toSlug("---hello---")).toBe("hello");
    expect(toSlug("")).toMatch(/^site-[a-z0-9]+$/);
    for (const name of ["", "ab", "한글", "---", "a".repeat(60), "My Site!"]) {
      expect(toSlug(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(toSlug(name).length).toBeGreaterThanOrEqual(3);
      expect(toSlug(name).length).toBeLessThanOrEqual(40);
    }
  });
});

describe("[P4-3] pickUniqueSlug", () => {
  it("비어 있으면 그대로 쓴다", async () => {
    const taken = new Set<string>();
    expect(await pickUniqueSlug("my-site", async (s) => taken.has(s))).toBe("my-site");
  });

  it("이미 쓰는 주소면 숫자를 붙여 피한다", async () => {
    const taken = new Set(["my-site", "my-site-2"]);
    expect(await pickUniqueSlug("my-site", async (s) => taken.has(s))).toBe("my-site-3");
  });

  it("숫자를 붙여도 40자를 넘기지 않는다", async () => {
    const long = "a".repeat(40);
    const slug = await pickUniqueSlug(long, async (s) => s === long);
    expect(slug).not.toBe(long);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
