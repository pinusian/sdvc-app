import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTIFACT_BUCKET, contentTypeOf } from "@/lib/artifacts/storage";

/**
 * [P7-6a] 산출물 버전 보관 (FR-012).
 *
 * 지금까지는 고칠 때마다 같은 경로에 덮어써서 **이전 모습이 사라졌다.**
 * 고쳤다가 더 나빠지면 되돌릴 방법이 없었다 — 유지보수 기능([P7-4b])을
 * 넣은 이상 되돌리기가 짝으로 있어야 한다.
 *
 * **`artifacts`와 버킷을 나눈다.** 같은 버킷에 `.versions/` 같은 폴더로 두면
 * `/site/{주소}` 서빙이 한 번만 어긋나도 옛 버전이 통째로 공개된다.
 * 첨부(`attachments`)를 나눈 것과 같은 이유다.
 *
 * **표를 만들지 않는다.** 폴더 이름(`0001`…)이 순서이고, `meta.json`에
 * 시각과 그때의 요청을 적는다 — 마이그레이션 없이 목록을 만들 수 있다.
 */

export const VERSION_BUCKET = "versions";

/**
 * 보관 개수 상한. 전체 사본 방식이라 고칠 때마다 프로젝트 크기만큼 쌓인다.
 * 홈페이지 하나는 보통 수십 KB지만, 사진이 많은 프로젝트를 수십 번 고치면
 * 수십 MB가 된다. 오래된 것부터 지운다.
 */
export const MAX_VERSIONS = 20;

export interface VersionMeta {
  /** 이 사본을 남긴 시각 (ISO) */
  at: string;
  /** 그때 사용자가 무엇을 요청했는지 — 목록에서 고를 때의 단서 */
  request: string;
  /**
   * [P7-12] 이 버전에서 **실제로 내용이 바뀐 파일들** (SC-008).
   *
   * "고쳤다"는 말이 아니라 결과를 남긴다. 옛 버전에는 없는 항목이라
   * 선택값이다 — 없으면 "기록 이전"이라는 뜻이지 "안 바뀌었다"가 아니다.
   */
  changed?: string[];
}

export interface VersionEntry {
  name: string;
  meta: VersionMeta | null;
}

/** `0001`, `0002`… 다음 이름. */
export function nextVersionName(existing: string[]): string {
  const highest = existing
    .map((name) => Number.parseInt(name, 10))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => Math.max(max, n), 0);
  return String(highest + 1).padStart(4, "0");
}

/** 폴더 하나 아래의 파일을 (하위 폴더까지) 모두 모은다. */
async function listFilesUnder(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<string[]> {
  // 폴더가 아주 깊어지는 일은 없다. 무한 재귀만 막는다.
  if (depth > 4) return [];

  const { data, error } = await admin.storage.from(bucket).list(prefix);
  if (error || !data) return [];

  const found: string[] = [];
  for (const entry of data) {
    const path = `${prefix}/${entry.name}`;
    // Supabase는 폴더를 id가 없는 항목으로 돌려준다.
    if (entry.id === null || entry.id === undefined) {
      found.push(...(await listFilesUnder(admin, bucket, path, depth + 1)));
    } else {
      found.push(path);
    }
  }
  return found;
}

/**
 * 지금 산출물 전부를 새 버전으로 남긴다. 남길 파일이 없으면 null.
 *
 * 발행이 **끝난 뒤**에 부른다 — 그래야 "지금 보이는 상태"도 목록에 있다.
 */
export async function saveVersion(
  admin: SupabaseClient,
  {
    projectId,
    request,
    changed,
    now = new Date(),
  }: { projectId: string; request: string; changed?: string[]; now?: Date },
): Promise<string | null> {
  const livePaths = await listFilesUnder(admin, ARTIFACT_BUCKET, projectId);
  if (livePaths.length === 0) return null;

  const { data: existing } = await admin.storage.from(VERSION_BUCKET).list(projectId);
  const names = (existing ?? []).map((entry) => entry.name).filter((n) => /^\d{4}$/.test(n));
  const version = nextVersionName(names);

  for (const path of livePaths) {
    const relative = path.slice(projectId.length + 1);
    const { data, error } = await admin.storage.from(ARTIFACT_BUCKET).download(path);
    if (error || !data) continue; // 한 파일 때문에 사본 전체를 포기하지 않는다

    const bytes = new Uint8Array(await data.arrayBuffer());
    await admin.storage
      .from(VERSION_BUCKET)
      .upload(`${projectId}/${version}/${relative}`, bytes as unknown as ArrayBuffer, {
        upsert: true,
      });
  }

  const meta: VersionMeta = { at: now.toISOString(), request, ...(changed ? { changed } : {}) };
  await admin.storage
    .from(VERSION_BUCKET)
    .upload(`${projectId}/${version}/meta.json`, JSON.stringify(meta), {
      contentType: "application/json",
      upsert: true,
    });

  await trimOldVersions(admin, projectId, [...names, version]);
  return version;
}

/** 상한을 넘으면 오래된 버전부터 지운다. */
async function trimOldVersions(
  admin: SupabaseClient,
  projectId: string,
  names: string[],
): Promise<void> {
  const sorted = [...names].sort();
  const tooMany = sorted.length - MAX_VERSIONS;
  if (tooMany <= 0) return;

  for (const name of sorted.slice(0, tooMany)) {
    const paths = await listFilesUnder(admin, VERSION_BUCKET, `${projectId}/${name}`);
    if (paths.length > 0) await admin.storage.from(VERSION_BUCKET).remove(paths);
  }
}

/** 보관된 버전 목록. **최신이 위로** 온다. */
export async function listVersions(
  admin: SupabaseClient,
  projectId: string,
): Promise<VersionEntry[]> {
  const { data, error } = await admin.storage.from(VERSION_BUCKET).list(projectId);
  if (error || !data) return [];

  const names = data
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}$/.test(name))
    .sort()
    .reverse();

  const entries: VersionEntry[] = [];
  for (const name of names) {
    entries.push({ name, meta: await readMeta(admin, projectId, name) });
  }
  return entries;
}

async function readMeta(
  admin: SupabaseClient,
  projectId: string,
  version: string,
): Promise<VersionMeta | null> {
  const { data, error } = await admin.storage
    .from(VERSION_BUCKET)
    .download(`${projectId}/${version}/meta.json`);
  if (error || !data) return null;

  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(await data.arrayBuffer())));
  } catch {
    return null;
  }
}

/** 프로젝트의 모든 버전 사본을 지운다 (해지 잠금·유예 삭제와 함께 쓴다). */
export async function deleteAllVersions(
  admin: SupabaseClient,
  projectId: string,
): Promise<number> {
  const paths = await listFilesUnder(admin, VERSION_BUCKET, projectId);
  if (paths.length === 0) return 0;

  const { error } = await admin.storage.from(VERSION_BUCKET).remove(paths);
  if (error) throw new Error(`버전 사본 삭제 실패: ${error.message}`);
  return paths.length;
}

export interface RestoreResult {
  fileCount: number;
  removedCount: number;
}

/**
 * [P7-6b] 그 버전으로 되돌린다 (FR-012).
 *
 * 가장 조심할 것은 **그 버전에 없던 파일을 지우는 일**이다. 남겨두면 옛 화면과
 * 새 파일이 섞여 "되돌렸는데 이상한 상태"가 된다 — 되돌리기의 의미가 없어진다.
 *
 * 되돌린 결과도 나중에 새 버전으로 남긴다(부르는 쪽에서) — 되돌리기를 다시
 * 되돌릴 수 있어야 하기 때문이다.
 */
export async function restoreVersion(
  admin: SupabaseClient,
  { projectId, version }: { projectId: string; version: string },
): Promise<RestoreResult> {
  const prefix = `${projectId}/${version}`;
  const versionPaths = await listFilesUnder(admin, VERSION_BUCKET, prefix);
  // meta.json은 우리 기록일 뿐 홈페이지 파일이 아니다.
  const files = versionPaths.filter((path) => !path.endsWith("/meta.json"));

  if (files.length === 0) {
    throw new Error("그 버전을 찾을 수 없습니다.");
  }

  const wanted = new Set(files.map((path) => path.slice(prefix.length + 1)));

  // 1) 그 버전의 파일을 덮어쓴다.
  for (const path of files) {
    const relative = path.slice(prefix.length + 1);
    const { data, error } = await admin.storage.from(VERSION_BUCKET).download(path);
    if (error || !data) continue;

    const bytes = new Uint8Array(await data.arrayBuffer());
    await admin.storage
      .from(ARTIFACT_BUCKET)
      .upload(`${projectId}/${relative}`, bytes as unknown as ArrayBuffer, {
        contentType: contentTypeOf(relative),
        upsert: true,
      });
  }

  // 2) 그 버전에 없던 파일은 지운다.
  const livePaths = await listFilesUnder(admin, ARTIFACT_BUCKET, projectId);
  const extra = livePaths.filter((path) => !wanted.has(path.slice(projectId.length + 1)));
  if (extra.length > 0) {
    const { error } = await admin.storage.from(ARTIFACT_BUCKET).remove(extra);
    if (error) throw new Error(`되돌리기 중 옛 파일 정리 실패: ${error.message}`);
  }

  return { fileCount: files.length, removedCount: extra.length };
}
