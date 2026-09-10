import { describe, expect, it } from "vitest";
import { parseArtifactFiles, MAX_FILES, MAX_FILE_BYTES } from "@/lib/artifacts/parse";

/**
 * [P4-3] Claude 답변에서 산출물 파일 뽑아내기.
 *
 * 구현 블록에서 모델은 파일을 ```file:경로 ... ``` 형태로 낸다.
 * 그 형식이 아닌 평범한 코드블록(설명용)은 파일로 취급하지 않는다.
 */

function block(path: string, content: string, lang = "file:") {
  return "```" + lang + path + "\n" + content + "\n```";
}

describe("[P4-3] parseArtifactFiles", () => {
  it("file: 표시가 붙은 코드블록만 파일로 뽑는다", () => {
    const answer = [
      "홈페이지를 만들었습니다.",
      block("index.html", "<h1>안녕</h1>"),
      "설명용 코드입니다:",
      "```js\nconsole.log('설명용');\n```",
      block("css/style.css", "body { margin: 0; }"),
    ].join("\n\n");

    expect(parseArtifactFiles(answer)).toEqual([
      { path: "index.html", content: "<h1>안녕</h1>" },
      { path: "css/style.css", content: "body { margin: 0; }" },
    ]);
  });

  it("파일이 없으면 빈 배열을 준다", () => {
    expect(parseArtifactFiles("아직 계획 단계입니다.")).toEqual([]);
    expect(parseArtifactFiles("```html\n<h1>예시</h1>\n```")).toEqual([]);
  });

  it("내용 안에 백틱이 있어도 블록 끝을 제대로 찾는다", () => {
    const answer = block("index.html", "<p>``인용``</p>\n<p>끝</p>");
    expect(parseArtifactFiles(answer)).toEqual([
      { path: "index.html", content: "<p>``인용``</p>\n<p>끝</p>" },
    ]);
  });

  it("위험한 경로는 버린다", () => {
    const answer = [
      block("../secret.env", "x"),
      block("/etc/passwd", "x"),
      block("C:\\windows\\system32", "x"),
      block("a/../../b.html", "x"),
      block("ok.html", "<p>정상</p>"),
    ].join("\n\n");

    expect(parseArtifactFiles(answer)).toEqual([{ path: "ok.html", content: "<p>정상</p>" }]);
  });

  it("허용하지 않는 확장자는 버린다", () => {
    const answer = [
      block("run.sh", "rm -rf /"),
      block("app.exe", "x"),
      block("index.html", "<p>정상</p>"),
      block("script.js", "console.log(1)"),
      block("data.json", "{}"),
    ].join("\n\n");

    expect(parseArtifactFiles(answer).map((f) => f.path)).toEqual([
      "index.html",
      "script.js",
      "data.json",
    ]);
  });

  it("같은 경로가 두 번 나오면 뒤엣것으로 덮어쓴다", () => {
    const answer = [block("index.html", "<p>먼저</p>"), block("index.html", "<p>나중</p>")].join(
      "\n\n",
    );
    expect(parseArtifactFiles(answer)).toEqual([{ path: "index.html", content: "<p>나중</p>" }]);
  });

  it("파일 수와 크기에 상한을 둔다", () => {
    const many = Array.from({ length: MAX_FILES + 5 }, (_, i) =>
      block(`page${i}.html`, "<p>x</p>"),
    ).join("\n\n");
    expect(parseArtifactFiles(many)).toHaveLength(MAX_FILES);

    const huge = block("big.html", "x".repeat(MAX_FILE_BYTES + 1));
    expect(parseArtifactFiles(huge)).toEqual([]);
  });

  it("빈 파일은 만들지 않는다", () => {
    expect(parseArtifactFiles(block("empty.html", "   "))).toEqual([]);
  });
});
