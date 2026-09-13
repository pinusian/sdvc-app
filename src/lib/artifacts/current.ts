import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTIFACT_BUCKET } from "@/lib/artifacts/storage";

/**
 * [BL-018] 지금 배포된 파일을 모델에게 알려준다.
 *
 * 유지보수 지시문은 "이미 만들어져 서비스되고 있다"고만 알려주고 **실제
 * 파일은 주지 않았다.** 그래서 "제목을 바꿔줘"라고 하면 모델이
 * "현재 내용을 붙여넣어 주시겠어요?"라고 되물었다.
 *
 * 대화 기록에 파일이 남아 있으면 거기서 읽기는 한다. 그러나
 *   ① 기록이 길어지면 잘리고([P3-4] truncated)
 *   ② **되돌리기(P7-7) 뒤에는 실제 파일과 기록이 어긋난다** — 없는 버전을 고치게 된다
 * 그러니 근거는 대화가 아니라 **지금 저장된 것**이어야 한다.
 *
 * 다만 전부 실으면 토큰이 폭증하고, 그 값은 사용자의 월 한도에서 나간다.
 * 무엇을 싣고 무엇을 이름만 남길지는 순수 함수로 정해 시험 가능하게 둔다.
 */

/** 프롬프트에 실을 수 있는 전체 바이트. 넘으면 이름만 남긴다. */
export const MAX_PROMPT_BYTES = 60_000;

/** 프롬프트에 실을 수 있는 파일 수. */
export const MAX_PROMPT_FILES = 12;

/** 글로 읽어서 고칠 수 있는 것들. 그림·글꼴은 모델이 읽어도 소용없다. */
const TEXT_EXTENSIONS = new Set(["html", "css", "js", "json", "svg", "md", "txt", "webmanifest"]);

export interface CurrentFile {
  path: string;
  content: string;
}

export interface CurrentFiles {
  included: CurrentFile[];
  /** 내용 없이 이름만 알려줄 것들 — **있다는 사실까지 감추지는 않는다** */
  omitted: string[];
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

const isText = (path: string) =>
  TEXT_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() ?? "");

/** `index.html`이 먼저다 — 가장 자주 고치는 파일이고, 예산이 모자랄 때 먼저 살려야 한다. */
function byImportance(a: CurrentFile, b: CurrentFile): number {
  const rank = (p: string) => (p === "index.html" ? 0 : 1);
  return rank(a.path) - rank(b.path);
}

export function pickWithinBudget(files: CurrentFile[]): CurrentFiles {
  const included: CurrentFile[] = [];
  const omitted: string[] = [];
  let used = 0;

  for (const file of [...files].sort(byImportance)) {
    const size = byteLength(file.content);

    // **자르지 않는다.** 반쪽만 보여주면 모델이 반쪽으로 다시 내고
    // 나머지가 날아간다 — 고치려다 지우는 셈이다.
    const fits =
      isText(file.path) && included.length < MAX_PROMPT_FILES && used + size <= MAX_PROMPT_BYTES;

    if (fits) {
      included.push(file);
      used += size;
    } else {
      omitted.push(file.path);
    }
  }

  return { included, omitted };
}

/** 프로젝트 폴더의 파일 경로를 모은다 (한 겹 아래까지). */
async function listPaths(admin: SupabaseClient, projectId: string): Promise<string[]> {
  const bucket = admin.storage.from(ARTIFACT_BUCKET);
  const paths: string[] = [];

  const { data: top } = await bucket.list(projectId);
  for (const entry of top ?? []) {
    // Supabase는 폴더에 id를 주지 않는다 — 그것으로 파일과 폴더를 가른다.
    if (entry.id) {
      paths.push(entry.name);
      continue;
    }
    const { data: inner } = await bucket.list(`${projectId}/${entry.name}`);
    for (const child of inner ?? []) {
      if (child.id) paths.push(`${entry.name}/${child.name}`);
    }
  }

  return paths;
}

/**
 * 지금 배포된 파일을 읽어 프롬프트에 실을 만큼만 골라 돌려준다.
 *
 * **실패해도 던지지 않는다** — 파일을 못 읽었다고 대화를 막으면,
 * 알려주려던 편의가 도리어 서비스를 끊는다. 못 읽으면 예전처럼
 * 모델이 되물을 뿐이다.
 */
export async function loadCurrentFiles(
  admin: SupabaseClient,
  projectId: string,
): Promise<CurrentFiles> {
  try {
    const paths = await listPaths(admin, projectId);
    const bucket = admin.storage.from(ARTIFACT_BUCKET);

    const files: CurrentFile[] = [];
    const unreadable: string[] = [];

    // [BL-021c] **한꺼번에 내려받는다.** 하나씩 줄세우면 그 시간이 전부
    // 첫 글자가 나오기 전에 흘러간다 — 파일 11개짜리 프로젝트에서 5.8초를
    // 실측했고, 함수와 저장소의 리전이 다르면 더 벌어진다.
    const textPaths: string[] = [];
    for (const path of paths) {
      if (isText(path)) textPaths.push(path);
      else unreadable.push(path);
    }

    const downloaded = await Promise.all(
      textPaths.map(async (path) => {
        const { data, error } = await bucket.download(`${projectId}/${path}`);
        if (error || !data) return { path, content: null };
        return { path, content: await data.text() };
      }),
    );

    // 순서는 내려받은 순서가 아니라 **요청한 순서**로 되돌린다 —
    // 프롬프트에 실리는 차례가 실행마다 달라지면 원인을 쫓기 어려워진다.
    for (const { path, content } of downloaded) {
      if (content === null) unreadable.push(path);
      else files.push({ path, content });
    }

    const picked = pickWithinBudget(files);
    return { included: picked.included, omitted: [...picked.omitted, ...unreadable] };
  } catch {
    return { included: [], omitted: [] };
  }
}
