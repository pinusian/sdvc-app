import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * [P8-13] 유지보수용 전체 프로젝트 열람 (FR-045).
 *
 * "운영자(최고관리자)는 개발자들이 만든 모든 프로젝트를 유지보수 차원에서
 * 볼 수 있으면 좋겠다"는 요청 그대로 만든다. **소유자 조건을 걸지 않는다**
 * — `admin/developers.ts`와 같은 이유로, 관리자는 남의 것을 봐야 한다.
 *
 * `projects.owner_id`는 `auth.users`를 참조하고 `profiles`를 직접
 * 참조하지 않으므로 PostgREST 임베드 조인(`select('*, profiles(...)')`)이
 * 안 먹는다 — 두 번 조회해 자바스크립트에서 합친다(`findConversationsByProjects`
 * ·`admin/developers.ts`와 같은 방식).
 */

export interface AdminProjectRow {
  id: string;
  /** 탈퇴해 프로필이 사라졌으면 짧은 id로 — 빈칸으로 두면 누구 것인지 사라진다 */
  ownerEmail: string;
  name: string;
  slug: string;
  status: string;
  visibility: string;
  createdAt: string;
}

interface RawProjectRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  status: string;
  visibility: string;
  created_at: string;
}

const COLUMNS = "id, owner_id, name, slug, status, visibility, created_at";

/** 한 화면에서 훑어보는 것이 목표이므로(개발자 목록과 같은 한도) 최근 것부터 이만큼만. */
const DEFAULT_LIMIT = 200;

export async function listAllProjectsForAdmin(
  admin: SupabaseClient,
  { limit = DEFAULT_LIMIT }: { limit?: number } = {},
): Promise<AdminProjectRow[]> {
  const { data, error } = await admin
    .from("projects")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`전체 프로젝트 조회 실패: ${error.message}`);

  const rows = (data ?? []) as RawProjectRow[];
  if (rows.length === 0) return [];

  const ownerIds = [...new Set(rows.map((row) => row.owner_id))];
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, email")
    .in("id", ownerIds);

  if (profileError) throw new Error(`계정 조회 실패: ${profileError.message}`);

  const emailOf = new Map(
    ((profiles ?? []) as { id: string; email: string }[]).map((p) => [p.id, p.email]),
  );

  return rows.map((row) => ({
    id: row.id,
    // 탈퇴한 계정은 profiles에 없다 — 짧은 id로라도 남긴다.
    ownerEmail: emailOf.get(row.owner_id) ?? row.owner_id.slice(0, 8),
    name: row.name,
    slug: row.slug,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
  }));
}
