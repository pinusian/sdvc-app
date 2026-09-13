import { describe, expect, it } from "vitest";
import { pickWithinBudget, MAX_PROMPT_BYTES, MAX_PROMPT_FILES } from "@/lib/artifacts/current";

/**
 * [BL-018] 지금 배포된 파일을 모델에게 알려준다.
 *
 * 유지보수 지시문은 "이미 만들어져 서비스되고 있다"고만 알려주고 **실제
 * 파일은 주지 않았다.** 그래서 "제목을 바꿔줘"라고 하면 모델이
 * "현재 내용을 붙여넣어 주시겠어요?"라고 되물었다.
 *
 * 대화 기록에 파일이 남아 있으면 거기서 읽지만, ①기록이 길어 잘리거나
 * ②**되돌리기(P7-7) 뒤에는 실제 파일과 기록이 어긋난다.**
 * 그러니 대화가 아니라 **지금 저장된 것**을 근거로 삼아야 한다.
 *
 * 다만 전부 실으면 토큰이 폭증한다 — 사용자의 월 한도에서 나가는 값이다.
 * 무엇을 싣고 무엇을 이름만 남길지는 순수 함수로 정해 시험 가능하게 둔다.
 */

const file = (path: string, size: number) => ({ path, content: "x".repeat(size) });

describe("[BL-018] pickWithinBudget", () => {
  it("작은 파일들은 전부 싣는다", () => {
    const result = pickWithinBudget([file("index.html", 100), file("style.css", 50)]);

    expect(result.included.map((f) => f.path)).toEqual(["index.html", "style.css"]);
    expect(result.omitted).toEqual([]);
  });

  it("예산을 넘으면 **이름만** 남긴다 — 있다는 사실까지 감추지는 않는다", () => {
    const result = pickWithinBudget([
      file("index.html", 100),
      file("huge.html", MAX_PROMPT_BYTES + 1),
    ]);

    expect(result.included.map((f) => f.path)).toEqual(["index.html"]);
    expect(result.omitted).toEqual(["huge.html"]);
  });

  it("index.html을 먼저 싣는다 — 가장 자주 고치는 파일이다", () => {
    const result = pickWithinBudget([file("z.css", 10), file("index.html", 10), file("a.js", 10)]);

    expect(result.included[0].path).toBe("index.html");
  });

  it("파일이 아주 많으면 개수도 제한한다", () => {
    const many = Array.from({ length: MAX_PROMPT_FILES + 5 }, (_, i) => file(`p${i}.html`, 10));
    const result = pickWithinBudget(many);

    expect(result.included).toHaveLength(MAX_PROMPT_FILES);
    expect(result.omitted).toHaveLength(5);
  });

  it("그림·글꼴처럼 글이 아닌 것은 내용 없이 이름만 — 모델이 읽어도 소용없다", () => {
    const result = pickWithinBudget([file("index.html", 10), file("logo.png", 10)]);

    expect(result.included.map((f) => f.path)).toEqual(["index.html"]);
    expect(result.omitted).toContain("logo.png");
  });

  it("빈 목록은 빈 결과 — 터지지 않는다", () => {
    expect(pickWithinBudget([])).toEqual({ included: [], omitted: [] });
  });

  it("한 파일이 통째로 예산을 넘으면 잘라 싣지 않고 뺀다 — 반쪽 파일을 고치면 나머지가 날아간다", () => {
    const result = pickWithinBudget([file("only.html", MAX_PROMPT_BYTES * 2)]);

    expect(result.included).toEqual([]);
    expect(result.omitted).toEqual(["only.html"]);
  });
});

/**
 * [BL-021c] 파일을 하나씩 줄세워 내려받으면 스트림이 그만큼 늦게 열린다.
 *
 * 빵집 프로젝트(글파일 11개)로 실측했더니 **5.8초**(내려받기만 4.7초)였고,
 * 이 시간은 전부 **첫 글자가 나오기 전에** 흘러간다. Vercel 함수와 Supabase
 * 리전이 다르면 왕복이 길어져 더 나빠진다.
 */
describe("[BL-021c] 파일을 한꺼번에 내려받는다", () => {
  function bucketWith(paths: string[], onDownload: (path: string) => void) {
    return {
      storage: {
        from: () => ({
          list: async (prefix: string) =>
            prefix.includes("/")
              ? { data: [], error: null }
              : { data: paths.map((p) => ({ name: p, id: p })), error: null },
          download: async (key: string) => {
            onDownload(key);
            // 일부러 늦게 끝낸다 — 줄세워 부르면 합계가 눈에 띄게 커진다.
            await new Promise((r) => setTimeout(r, 20));
            return { data: { text: async () => "내용" }, error: null };
          },
        }),
      },
    } as never;
  }

  it("11개를 순차가 아니라 동시에 부른다", async () => {
    const { loadCurrentFiles } = await import("@/lib/artifacts/current");
    const paths = Array.from({ length: 11 }, (_, i) => `f${i}.html`);

    let inFlight = 0;
    let maxInFlight = 0;
    const admin = bucketWith(paths, () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => (inFlight -= 1), 20);
    });

    const started = Date.now();
    const result = await loadCurrentFiles(admin, "project-1");
    const elapsed = Date.now() - started;

    expect(result.included).toHaveLength(11);
    // 줄세우면 11 × 20ms = 220ms 이상 걸린다. 한꺼번에 부르면 그 근처도 안 간다.
    expect(elapsed).toBeLessThan(200);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
