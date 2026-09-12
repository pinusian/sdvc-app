import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * [P4-3] projects 표 접근.
 *
 * conversations와 같은 원칙([P3-4]): RLS 정책이 없으므로 소유자 조건을
 * 코드가 매번 직접 건다. **딱 하나 예외가 `getProjectBySlug`** — 산출물
 * 공개 열람(`/site/{slug}`)은 주인이 아닌 사람도 보는 통로라서 소유자
 * 조건을 걸 수 없다. 대신 공개범위(visibility) 판단을 호출하는 쪽이
 * 반드시 해야 한다.
 */

export type Visibility = "private" | "link" | "public";
export type ProjectStatus = "draft" | "building" | "deployed" | "failed";

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  visibility: Visibility;
  status: ProjectStatus;
  /** [P8-6] 비상 차단 시각. null이면 정상 (FR-016) */
  blockedAt?: string | null;
}

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  visibility: Visibility;
  status: ProjectStatus;
  blocked_at?: string | null;
}

const COLUMNS = "id, owner_id, name, slug, visibility, status, blocked_at";

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    visibility: row.visibility,
    status: row.status,
    blockedAt: row.blocked_at ?? null,
  };
}

function assertNoError(error: unknown, what: string): void {
  if (!error) return;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  throw new Error(`${what} 실패: ${message}`);
}

export async function createProject(
  client: SupabaseClient,
  { ownerId, name, slug }: { ownerId: string; name: string; slug: string },
): Promise<Project> {
  const { data, error } = await client
    .from("projects")
    .insert({ owner_id: ownerId, name, slug })
    .select(COLUMNS)
    .single();

  assertNoError(error, "프로젝트 생성");
  return toProject(data as ProjectRow);
}

export async function getProjectById(
  client: SupabaseClient,
  projectId: string,
  ownerId: string,
): Promise<Project | null> {
  const { data, error } = await client
    .from("projects")
    .select(COLUMNS)
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  assertNoError(error, "프로젝트 조회");
  return data ? toProject(data as ProjectRow) : null;
}

/** 공개 열람용 — 소유자 조건을 걸지 않는다. 부르는 쪽이 공개범위를 판단해야 한다. */
export async function getProjectBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<Project | null> {
  const { data, error } = await client
    .from("projects")
    .select(COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  assertNoError(error, "프로젝트 조회");
  return data ? toProject(data as ProjectRow) : null;
}

export async function listProjects(
  client: SupabaseClient,
  ownerId: string,
): Promise<Project[]> {
  const { data, error } = await client
    .from("projects")
    .select(COLUMNS)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  assertNoError(error, "프로젝트 목록 조회");
  return ((data ?? []) as ProjectRow[]).map(toProject);
}

export async function isSlugTaken(client: SupabaseClient, slug: string): Promise<boolean> {
  const { data, error } = await client
    .from("projects")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  assertNoError(error, "주소 확인");
  return data !== null;
}

export async function setProjectStatus(
  client: SupabaseClient,
  projectId: string,
  ownerId: string,
  status: ProjectStatus,
): Promise<void> {
  const { error } = await client
    .from("projects")
    .update({ status })
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .select("id")
    .single();

  assertNoError(error, "프로젝트 상태 변경");
}

/** [P5-3] 공개범위를 바꾼다 (FR-007). */
export async function setProjectVisibility(
  client: SupabaseClient,
  projectId: string,
  ownerId: string,
  visibility: Visibility,
): Promise<void> {
  const { error } = await client
    .from("projects")
    .update({ visibility })
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .select("id")
    .single();

  assertNoError(error, "공개범위 변경");
}

/** [P7-1b] 이름을 바꾼다 (FR-030). 소유자 조건은 여기서 직접 건다. */
export async function renameProject(
  client: SupabaseClient,
  projectId: string,
  ownerId: string,
  name: string,
): Promise<void> {
  const { error } = await client
    .from("projects")
    .update({ name })
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .select("id")
    .single();

  assertNoError(error, "프로젝트 이름 변경");
}

/**
 * [P8-6] 비상 차단/해제 (FR-016).
 *
 * **지우지 않고 가린다** — 오판했을 때 되돌려야 하고, 분쟁 시 증거도 남아야 한다.
 * 관리자가 부르므로 소유자 조건을 걸지 않는다(권한은 `adminCan`이 판정한다).
 */
export async function setProjectBlocked(
  client: SupabaseClient,
  projectId: string,
  blocked: boolean,
  reason: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await client
    .from("projects")
    .update({
      blocked_at: blocked ? now.toISOString() : null,
      blocked_reason: blocked ? reason : null,
    })
    .eq("id", projectId)
    .select("id")
    .single();

  assertNoError(error, blocked ? "산출물 차단" : "차단 해제");
}

/** 행을 지운다. 내 것이 아니어서 지운 게 없으면 false. */
export async function deleteProjectRow(
  client: SupabaseClient,
  projectId: string,
  ownerId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();

  assertNoError(error, "프로젝트 삭제");
  return data !== null;
}
