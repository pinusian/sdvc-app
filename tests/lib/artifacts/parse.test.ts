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

/**
 * [P7-4b] 실제 검증에서 드러난 것: 모델은 코드블록에 **언어를 먼저** 적는다.
 *
 *     ```html file:index.html
 *
 * 우리 파서는 ```file: 만 알아서 이 파일들을 **조용히 버렸다.**
 * 모델이 "고쳤습니다"라고 답했는데 홈페이지는 그대로였다 — 가장 나쁜 종류의 실패다.
 */
describe("[P7-4b] 코드블록에 언어가 먼저 붙어도 알아본다", () => {
  it("```html file:index.html 형식을 읽는다", () => {
    const files = parseArtifactFiles(
      "고쳤습니다.\n\n```html file:index.html\n<h1>소금빵</h1>\n```\n",
    );

    expect(files).toEqual([{ path: "index.html", content: "<h1>소금빵</h1>" }]);
  });

  it("css·js 등 다른 언어도 마찬가지다", () => {
    const files = parseArtifactFiles(
      "```css file:style.css\nh1 { color: green; }\n```\n\n```javascript file:app.js\nconsole.log(1);\n```",
    );

    expect(files.map((f) => f.path)).toEqual(["style.css", "app.js"]);
    expect(files[0].content).toBe("h1 { color: green; }");
  });

  it("file: 앞뒤 공백이 있어도 읽는다", () => {
    const files = parseArtifactFiles("```html  file: index.html \n<h1>안녕</h1>\n```");

    expect(files).toEqual([{ path: "index.html", content: "<h1>안녕</h1>" }]);
  });

  it("언어만 있고 file: 표시가 없으면 여전히 저장하지 않는다 (설명용 코드)", () => {
    const files = parseArtifactFiles("이렇게 쓰시면 됩니다.\n\n```html\n<h1>예시</h1>\n```");

    expect(files).toEqual([]);
  });
});
