import { describe, expect, it } from "vitest";
import { canViewArtifact } from "@/lib/projects/access";
import type { Project } from "@/lib/projects/store";

/**
 * [P5-1] 산출물을 누가 볼 수 있는가 (FR-007).
 *
 * 저장소 자체가 잠겨 있으므로([P4-1]) 이 판단이 유일한 관문이다.
 * 판단이 틀리면 비공개 홈페이지가 그대로 새어나간다 — 그래서 애매하면 막는다.
 */

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    ownerId: "owner-1",
    name: "내 홈페이지",
    slug: "my-homepage",
    visibility: "private",
    status: "deployed",
    ...overrides,
  };
}

describe("[P5-1] canViewArtifact", () => {
  it("비공개는 주인만 본다", () => {
    expect(canViewArtifact(project(), "owner-1")).toBe(true);
    expect(canViewArtifact(project(), "someone-else")).toBe(false);
    expect(canViewArtifact(project(), null)).toBe(false);
  });

  it("링크 공개는 주소를 아는 누구나 본다", () => {
    const p = project({ visibility: "link" });
    expect(canViewArtifact(p, null)).toBe(true);
    expect(canViewArtifact(p, "someone-else")).toBe(true);
  });

  it("전체 공개도 누구나 본다", () => {
    const p = project({ visibility: "public" });
    expect(canViewArtifact(p, null)).toBe(true);
    expect(canViewArtifact(p, "someone-else")).toBe(true);
  });

  it("아직 완성되지 않은 것은 공개 설정이어도 주인만 본다", () => {
    // 만들다 만 것을 남에게 보여주면 곤란하다.
    for (const status of ["draft", "building", "failed"] as const) {
      const p = project({ visibility: "public", status });
      expect(canViewArtifact(p, null), status).toBe(false);
      expect(canViewArtifact(p, "owner-1"), status).toBe(true);
    }
  });

  it("모르는 공개범위 값이면 막는다 (fail-closed)", () => {
    const p = project({ visibility: "everyone" as never });
    expect(canViewArtifact(p, null)).toBe(false);
    expect(canViewArtifact(p, "owner-1")).toBe(true);
  });
});
