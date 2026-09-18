import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptApiKey, decryptApiKey } from "@/lib/site-accounts/crypto";

/**
 * [P11-1] 사용자(방문자) 계정·기록 저장소.
 *
 * `site_users`·`site_records` 둘 다 RLS는 켜져 있고 정책은 없다(=브라우저
 * 직접 접근 불가). 여기 오는 클라이언트는 secret key를 쓰는 서버측 관리자
 * 클라이언트여야 하고, `project_id`(필요하면 `site_user_id`까지) 조건은
 * **이 파일이 매번 직접 건다** — [P3-4]·[P4-3]과 같은 원칙이다.
 *
 * 개발자 계정(profiles)과는 완전히 분리된 별도 로그인 체계다. 표는
 * `supabase/migrations/0011_site_accounts.sql`.
 */

export interface SiteUser {
  id: string;
  projectId: string;
  email: string;
  displayName: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

interface SiteUserRow {
  id: string;
  project_id: string;
  email: string;
  display_name?: string | null;
  suspended_at?: string | null;
  suspended_reason?: string | null;
}

type Client = SupabaseClient;

const SITE_USER_COLUMNS = "id, project_id, email, display_name, suspended_at, suspended_reason";

function toSiteUser(row: SiteUserRow): SiteUser {
  return {
    id: row.id,
    projectId: row.project_id,
    email: row.email,
    displayName: row.display_name ?? null,
    suspendedAt: row.suspended_at ?? null,
    suspendedReason: row.suspended_reason ?? null,
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

export async function createSiteUser(
  client: Client,
  { projectId, email, passwordHash, displayName }: {
    projectId: string;
    email: string;
    passwordHash: string;
    displayName?: string;
  },
): Promise<SiteUser> {
  // 소문자로 저장한다 — DB의 유일 인덱스도 lower(email) 기준이다.
  // 대소문자만 다른 값으로 저장하면 인덱스와 findSiteUserByEmail의 조회가 어긋난다.
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    throw new Error("이메일을 입력해주세요.");
  }

  const { data, error } = await client
    .from("site_users")
    .insert({
      project_id: projectId,
      email: trimmedEmail,
      password_hash: passwordHash,
      display_name: displayName ?? null,
    })
    .select(SITE_USER_COLUMNS)
    .single();

  assertNoError(error, "사용자 계정 생성");
  return toSiteUser(data as SiteUserRow);
}

/** 로그인에 쓴다 — 반드시 같은 프로젝트 안에서만 찾는다(격리). */
export async function findSiteUserByEmail(
  client: Client,
  { projectId, email }: { projectId: string; email: string },
): Promise<(SiteUser & { passwordHash: string }) | null> {
  const { data, error } = await client
    .from("site_users")
    .select(`${SITE_USER_COLUMNS}, password_hash`)
    .eq("project_id", projectId)
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  assertNoError(error, "사용자 계정 조회");
  if (!data) return null;

  const row = data as SiteUserRow & { password_hash: string };
  return { ...toSiteUser(row), passwordHash: row.password_hash };
}

/**
 * [P11-3] 요청마다 본인 확인·정지 여부를 검사할 때 쓴다(`requireSiteUser`).
 * 세션 토큰에는 id만 들어 있으므로, 매 요청 지금 상태(특히 정지 여부)를
 * 다시 읽어야 한다 — 세션이 살아있어도 정지되면 즉시 막혀야 하기 때문이다.
 */
export async function getSiteUserById(client: Client, siteUserId: string): Promise<SiteUser | null> {
  const { data, error } = await client
    .from("site_users")
    .select(SITE_USER_COLUMNS)
    .eq("id", siteUserId)
    .maybeSingle();

  assertNoError(error, "사용자 계정 조회");
  return data ? toSiteUser(data as SiteUserRow) : null;
}

/** [P11-6] 개발자(교수) 관리 화면 — 그 프로젝트의 사용자 전체. */
export async function listSiteUsersByProject(
  client: Client,
  projectId: string,
): Promise<SiteUser[]> {
  const { data, error } = await client
    .from("site_users")
    .select(SITE_USER_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  assertNoError(error, "사용자 목록 조회");
  return ((data ?? []) as SiteUserRow[]).map(toSiteUser);
}

export async function suspendSiteUser(
  client: Client,
  { siteUserId, reason }: { siteUserId: string; reason: string },
): Promise<void> {
  const { error } = await client
    .from("site_users")
    .update({ suspended_at: new Date().toISOString(), suspended_reason: reason })
    .eq("id", siteUserId)
    .select("id")
    .single();

  assertNoError(error, "사용자 정지");
}

export async function unsuspendSiteUser(client: Client, siteUserId: string): Promise<void> {
  const { error } = await client
    .from("site_users")
    .update({ suspended_at: null, suspended_reason: null })
    .eq("id", siteUserId)
    .select("id")
    .single();

  assertNoError(error, "사용자 정지 해제");
}

/**
 * [P11-4] 사용자 본인의 Anthropic API 키를 암호화해서 저장한다.
 * 원문은 이 함수를 지나가는 순간부터 어디에도 남지 않는다.
 */
export async function setSiteUserApiKey(
  client: Client,
  { siteUserId, apiKey }: { siteUserId: string; apiKey: string },
): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("API 키를 입력해주세요.");
  }

  const { error } = await client
    .from("site_users")
    .update({ anthropic_api_key_encrypted: encryptApiKey(trimmed) })
    .eq("id", siteUserId)
    .select("id")
    .single();

  assertNoError(error, "API 키 저장");
}

/**
 * AI 기능을 대신 호출할 때만 쓴다. 키를 등록하지 않은 사용자는 null —
 * 그 사람에게는 AI 기능이 막힌다는 뜻이다(오류가 아니라 정상 상태).
 */
export async function getSiteUserApiKey(client: Client, siteUserId: string): Promise<string | null> {
  const { data, error } = await client
    .from("site_users")
    .select("anthropic_api_key_encrypted")
    .eq("id", siteUserId)
    .single();

  assertNoError(error, "API 키 조회");
  const encrypted = (data as { anthropic_api_key_encrypted: string | null } | null)
    ?.anthropic_api_key_encrypted;
  return encrypted ? decryptApiKey(encrypted) : null;
}

/**
 * [P11-4] 화면에 "등록됨"만 보여줄 때 쓴다 — `getSiteUserApiKey`처럼
 * 복호화하지 않는다. 값 자체가 필요 없는 곳에서 굳이 복호화할 이유가 없다.
 */
export async function hasSiteUserApiKey(client: Client, siteUserId: string): Promise<boolean> {
  const { data, error } = await client
    .from("site_users")
    .select("anthropic_api_key_encrypted")
    .eq("id", siteUserId)
    .single();

  assertNoError(error, "API 키 등록 여부 조회");
  return Boolean(
    (data as { anthropic_api_key_encrypted: string | null } | null)?.anthropic_api_key_encrypted,
  );
}

export interface SiteRecord {
  id: string;
  projectId: string;
  siteUserId: string;
  title: string;
  author: string | null;
  note: string | null;
}

interface SiteRecordRow {
  id: string;
  project_id: string;
  site_user_id: string;
  title: string;
  author?: string | null;
  note?: string | null;
}

const SITE_RECORD_COLUMNS = "id, project_id, site_user_id, title, author, note";

function toSiteRecord(row: SiteRecordRow): SiteRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    siteUserId: row.site_user_id,
    title: row.title,
    author: row.author ?? null,
    note: row.note ?? null,
  };
}

export async function createSiteRecord(
  client: Client,
  { projectId, siteUserId, title, author, note }: {
    projectId: string;
    siteUserId: string;
    title: string;
    author?: string;
    note?: string;
  },
): Promise<SiteRecord> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error("제목을 입력해주세요.");
  }

  const { data, error } = await client
    .from("site_records")
    .insert({
      project_id: projectId,
      site_user_id: siteUserId,
      title: trimmedTitle,
      author: author?.trim() || null,
      note: note?.trim() || null,
    })
    .select(SITE_RECORD_COLUMNS)
    .single();

  assertNoError(error, "기록 생성");
  return toSiteRecord(data as SiteRecordRow);
}

/** 본인 기록만 — project_id와 site_user_id 둘 다로 격리한다. */
export async function listSiteRecordsByUser(
  client: Client,
  { projectId, siteUserId }: { projectId: string; siteUserId: string },
): Promise<SiteRecord[]> {
  const { data, error } = await client
    .from("site_records")
    .select(SITE_RECORD_COLUMNS)
    .eq("project_id", projectId)
    .eq("site_user_id", siteUserId)
    .order("created_at", { ascending: false });

  assertNoError(error, "기록 목록 조회");
  return ((data ?? []) as SiteRecordRow[]).map(toSiteRecord);
}
