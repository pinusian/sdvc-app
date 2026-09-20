// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  documentOutputInstruction,
  parseGeneratedDocuments,
  persistGeneratedDocuments,
} from "@/lib/sdvc/generated-documents";

describe("[T029] 대화 응답의 구조화 문서 저장 계약", () => {
  it("헌장·명세 블록은 두 문서 경계를 모두 요구한다", () => {
    const instruction = documentOutputInstruction("constitution_specify");

    expect(instruction).toContain("SDVC_DOCUMENT:constitution");
    expect(instruction).toContain("SDVC_DOCUMENT:spec");
  });

  it("블록별 문서를 모델 응답에서 분리한다", () => {
    const answer = [
      "정리했습니다.",
      "<!-- SDVC_DOCUMENT:constitution -->",
      "# 헌장\n- 비밀값을 기록하지 않는다.",
      "<!-- /SDVC_DOCUMENT -->",
      "<!-- SDVC_DOCUMENT:spec -->",
      "# 명세\n- 기록을 저장한다.",
      "<!-- /SDVC_DOCUMENT -->",
    ].join("\n");

    expect(parseGeneratedDocuments(answer, "constitution_specify")).toEqual([
      { kind: "constitution", content: "# 헌장\n- 비밀값을 기록하지 않는다." },
      { kind: "spec", content: "# 명세\n- 기록을 저장한다." },
    ]);
  });

  it("게이트를 냈는데 필요한 문서가 빠지면 fail-closed 한다", () => {
    const answer = [
      "<!-- SDVC_DOCUMENT:constitution -->",
      "# 헌장",
      "<!-- /SDVC_DOCUMENT -->",
    ].join("\n");

    expect(() => parseGeneratedDocuments(answer, "constitution_specify")).toThrow(
      "필수 구조화 문서",
    );
  });

  it("추출한 문서를 프로젝트의 불변 버전으로 모두 저장한다", async () => {
    const saveDocument = vi.fn().mockResolvedValue({ id: "version-1" });
    const answer = [
      "<!-- SDVC_DOCUMENT:plan -->",
      "# 계획\nNext.js로 만든다.",
      "<!-- /SDVC_DOCUMENT -->",
    ].join("\n");

    await persistGeneratedDocuments(
      {
        projectId: "project-1",
        block: "plan",
        answer,
        now: "2026-09-20T07:00:00.000Z",
      },
      { saveDocument },
    );

    expect(saveDocument).toHaveBeenCalledWith({
      projectId: "project-1",
      kind: "plan",
      content: "# 계획\nNext.js로 만든다.",
      now: "2026-09-20T07:00:00.000Z",
    });
  });
});
