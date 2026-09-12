/**
 * [P4-3] Claude 답변에서 산출물 파일 뽑아내기.
 *
 * 구현 블록에서 모델은 파일을 이렇게 낸다:
 *
 *     ```file:index.html
 *     <h1>안녕</h1>
 *     ```
 *
 * 설명하려고 넣은 평범한 코드블록과 구분하기 위해 `file:` 표시를 요구한다.
 *
 * 여기 들어오는 것은 **모델이 만든 문자열**이므로 신뢰하지 않는다.
 * 경로를 그대로 믿고 저장하면 `../`로 다른 프로젝트 폴더를 덮어쓸 수 있다.
 */

export interface ArtifactFile {
  path: string;
  content: string;
}

/** 한 프로젝트에 담을 수 있는 파일 수 */
export const MAX_FILES = 30;
/** 파일 하나의 최대 크기 (Storage 버킷 제한 5MB보다 낮게 잡는다) */
export const MAX_FILE_BYTES = 512 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "html", "css", "js", "json", "txt", "md", "svg", "webmanifest",
]);

/**
 * ```file:경로 ... ``` 블록을 모두 찾는다.
 *
 * [P7-4b] 모델은 습관적으로 언어를 먼저 적는다(```html file:index.html).
 * 이걸 못 읽어서 "고쳤습니다"라는 답변과 함께 파일이 통째로 버려졌다 —
 * 사용자는 고쳐진 줄 알았는데 홈페이지는 그대로였다. 언어 표시와
 * `file:` 앞뒤 공백을 모두 허용한다.
 */
const FILE_BLOCK =
  /^```[ \t]*[a-zA-Z0-9+#-]*[ \t]*file:[ \t]*([^\n`]+?)[ \t]*\n([\s\S]*?)^```/gm;

export function parseArtifactFiles(answer: string): ArtifactFile[] {
  const byPath = new Map<string, string>();

  for (const match of answer.matchAll(FILE_BLOCK)) {
    const path = normalizePath(match[1]);
    if (!path) continue;

    const content = match[2].replace(/\n$/, "");
    if (content.trim().length === 0) continue;
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) continue;

    // 같은 경로가 두 번 나오면 나중 것이 이긴다 (모델이 고쳐 쓴 경우).
    byPath.delete(path);
    byPath.set(path, content);
  }

  return [...byPath].slice(0, MAX_FILES).map(([path, content]) => ({ path, content }));
}

/** 저장해도 되는 상대 경로면 정리해서 돌려주고, 아니면 null. */
function normalizePath(raw: string): string | null {
  const path = raw.trim();
  if (!path) return null;

  if (path.includes("\\")) return null; // 윈도우 경로·이스케이프
  if (path.startsWith("/")) return null; // 절대 경로
  if (/^[a-zA-Z]:/.test(path)) return null; // C: 같은 드라이브 문자
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  if (path.length > 120) return null;
  if (!/^[a-zA-Z0-9._/-]+$/.test(path)) return null; // 공백·한글·특수문자 금지

  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) return null;

  return path;
}

/**
 * [P7-10] 첨부한 이미지를 산출물에 넣으라는 지시 (FR-032).
 *
 * 이미지는 모델이 글로 만들 수 없다. 그래서 파일 블록 대신 한 줄짜리 지시를 쓴다:
 *
 *     ```use-image:images/hero.png@<첨부id>```
 *
 * 실제 내용은 사용자가 올린 첨부에서 가져온다 — 모델은 "어디에 둘지"만 정한다.
 */

/** 산출물에 넣을 수 있는 이미지 확장자 */
export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export interface ImageUse {
  /** 프로젝트 안에서의 경로 (예: images/hero.png) */
  path: string;
  attachmentId: string;
}

export interface ImageUseResult {
  uses: ImageUse[];
  /** 알아보지 못한 지시. **버리지 않고 사용자에게 알린다** */
  invalid: string[];
}

const IMAGE_USE_BLOCK = /^```[ \t]*use-image:[ \t]*([^\n`]+?)[ \t]*```[ \t]*$/gm;

export function parseImageUses(answer: string): ImageUseResult {
  const uses: ImageUse[] = [];
  const invalid: string[] = [];

  for (const match of answer.matchAll(IMAGE_USE_BLOCK)) {
    const spec = match[1].trim();
    const at = spec.lastIndexOf("@");

    if (at <= 0 || at === spec.length - 1) {
      invalid.push(`${spec} (첨부 id가 빠졌습니다)`);
      continue;
    }

    const rawPath = spec.slice(0, at).trim();
    const attachmentId = spec.slice(at + 1).trim();

    const path = normalizeImagePath(rawPath);
    if (!path) {
      invalid.push(`${rawPath} (넣을 수 없는 경로입니다)`);
      continue;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(attachmentId)) {
      invalid.push(`${rawPath} (첨부 id 모양이 이상합니다)`);
      continue;
    }

    uses.push({ path, attachmentId });
  }

  return { uses, invalid };
}

/** 파일 경로 규칙은 같되, 이미지 확장자만 허용한다. */
function normalizeImagePath(raw: string): string | null {
  const path = raw.trim();
  if (!path) return null;
  if (path.includes("\\")) return null;
  if (path.startsWith("/")) return null;
  if (/^[a-zA-Z]:/.test(path)) return null;
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  if (path.length > 120) return null;
  if (!/^[a-zA-Z0-9._/-]+$/.test(path)) return null;

  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension || !IMAGE_EXTENSIONS.has(extension)) return null;

  return path;
}
