import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactFile } from "@/lib/artifacts/parse";
import { readAttachment, resolveAttachment } from "@/lib/attachments/store";

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
  // [P7-10] 첨부에서 복사해 오는 이미지들
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
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

/**
 * [P7-10] 사용자가 올린 첨부를 산출물 폴더로 복사한다 (FR-032).
 *
 * 이미지는 모델이 만들 수 없으므로 **원본을 그대로 옮긴다.**
 * 산출물 폴더에 들어간 뒤로는 공개범위·해지 잠금·유예 삭제 규칙이
 * 나머지 파일과 똑같이 적용된다(Clarify 13) — 그래서 링크를 걸지 않고 복사한다.
 */
export async function copyAttachmentToArtifact(
  admin: SupabaseClient,
  {
    ownerId,
    conversationId,
    attachmentId,
    projectId,
    path,
  }: {
    ownerId: string;
    conversationId: string;
    attachmentId: string;
    projectId: string;
    path: string;
  },
): Promise<void> {
  const found = await resolveAttachment(admin, {
    ownerId,
    conversationId,
    id: attachmentId,
  });
  if (!found) throw new Error("첨부를 찾을 수 없습니다.");
  if (found.kind !== "image") throw new Error("이미지가 아닌 첨부는 넣을 수 없습니다.");

  const bytes = await readAttachment(admin, found);

  const { error } = await admin.storage
    .from(ARTIFACT_BUCKET)
    .upload(`${projectId}/${path}`, bytes as unknown as ArrayBuffer, {
      contentType: found.mediaType,
      upsert: true,
    });

  if (error) throw new Error(`이미지 저장 실패: ${error.message}`);
}
