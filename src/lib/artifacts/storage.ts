import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactFile } from "@/lib/artifacts/parse";

/**
 * [P4-3] 산출물 파일을 Supabase Storage에 올리고 지운다.
 *
 * 버킷은 비공개다([P4-1]). 여기 오는 클라이언트는 secret key를 쓰는
 * 서버측 관리자 클라이언트여야 한다.
 * 파일은 `artifacts/{projectId}/...` 아래에 모인다 — 프로젝트를 지울 때
 * 이 앞부분만 훑으면 되기 때문이다.
 */

export const ARTIFACT_BUCKET = "artifacts";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  webmanifest: "application/manifest+json",
};

export function contentTypeOf(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "text/plain; charset=utf-8";
}

export async function uploadArtifactFiles(
  admin: SupabaseClient,
  projectId: string,
  files: ArtifactFile[],
): Promise<number> {
  const bucket = admin.storage.from(ARTIFACT_BUCKET);

  for (const file of files) {
    const { error } = await bucket.upload(`${projectId}/${file.path}`, file.content, {
      contentType: contentTypeOf(file.path),
      upsert: true, // 다시 만들기(재생성)를 지원한다
    });
    if (error) throw new Error(`파일 저장 실패(${file.path}): ${error.message}`);
  }

  return files.length;
}

/** 프로젝트 폴더의 파일을 하위 폴더까지 모두 지운다. 지운 개수를 돌려준다. */
export async function deleteArtifactFiles(
  admin: SupabaseClient,
  projectId: string,
): Promise<number> {
  const bucket = admin.storage.from(ARTIFACT_BUCKET);
  const paths = await collectPaths(bucket, projectId);
  if (paths.length === 0) return 0;

  const { error } = await bucket.remove(paths);
  if (error) throw new Error(`파일 삭제 실패: ${error.message}`);
  return paths.length;
}

type Bucket = ReturnType<SupabaseClient["storage"]["from"]>;

/** Storage에는 진짜 폴더가 없다 — id가 없는 항목이 폴더처럼 보이는 것이므로 재귀로 훑는다. */
async function collectPaths(bucket: Bucket, prefix: string): Promise<string[]> {
  const { data, error } = await bucket.list(prefix);
  if (error) throw new Error(`파일 목록 조회 실패: ${error.message}`);

  const paths: string[] = [];
  for (const entry of data ?? []) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id === null) paths.push(...(await collectPaths(bucket, full)));
    else paths.push(full);
  }
  return paths;
}
