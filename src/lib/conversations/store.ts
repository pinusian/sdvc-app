import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@/lib/claude/chat";
import type { BlockId } from "@/lib/sdvc/blocks";

/**
 * [P3-4] 대화 상태 저장소.
 *
 * 세션이 끊겨도 이어서 진행할 수 있도록 대화 진행 위치(current_block)와
 * 메시지를 DB에 남긴다. 표는 `supabase/migrations/0003_conversations.sql`.
 *
 * 두 표 모두 RLS 정책이 없으므로(=브라우저에서 직접 접근 불가) 여기 오는
 * 클라이언트는 **secret key를 쓰는 서버측 관리자 클라이언트**여야 한다.
 * 그래서 모든 조회·수정에 소유자 조건(owner_id)을 코드가 직접 건다 —
 * RLS가 막아주지 않으니 빠뜨리면 남의 대화가 보인다.
 */

export interface Conversation {
  id: string;
  ownerId: string;
  currentBlock: BlockId;
  /** 프로젝트 이름으로도 쓰인다([P4-3]). 아직 없으면 null */
  title: string | null;
  /** 이 대화로 만들어진 산출물 프로젝트. 아직 없으면 null */
  projectId: string | null;
}

interface ConversationRow {
  id: string;
  owner_id: string;
  current_block: BlockId;
  title?: string | null;
  project_id?: string | null;
}

type Client = SupabaseClient;

const COLUMNS = "id, owner_id, current_block, title, project_id";

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    ownerId: row.owner_id,
    currentBlock: row.current_block,
    title: row.title ?? null,
    projectId: row.project_id ?? null,
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

export async function createConversation(
  client: Client,
  { ownerId, title, currentBlock = "constitution_specify" }: {
    ownerId: string;
    title?: string;
    currentBlock?: BlockId;
  },
): Promise<Conversation> {
  const { data, error } = await client
    .from("conversations")
    .insert({ owner_id: ownerId, title: title ?? null, current_block: currentBlock })
    .select(COLUMNS)
    .single();

  assertNoError(error, "대화 생성");
  return toConversation(data as ConversationRow);
}

/** 소유자 본인의 대화만 돌려준다. 없거나 남의 것이면 null. */
export async function getConversation(
  client: Client,
  conversationId: string,
  ownerId: string,
): Promise<Conversation | null> {
  const { data, error } = await client
    .from("conversations")
    .select(COLUMNS)
    .eq("id", conversationId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  assertNoError(error, "대화 조회");
  return data ? toConversation(data as ConversationRow) : null;
}

export async function appendMessage(
  client: Client,
  { conversationId, role, content }: {
    conversationId: string;
    role: ChatMessage["role"];
    content: string;
  },
): Promise<void> {
  if (content.trim().length === 0) {
    throw new Error("빈 메시지는 저장할 수 없습니다.");
  }

  const { error } = await client
    .from("messages")
    .insert({ conversation_id: conversationId, role, content })
    .select("id")
    .single();

  assertNoError(error, "메시지 저장");
}

/** 대화 기록을 Claude에 그대로 넘길 수 있는 형태로 돌려준다. */
export async function listMessages(
  client: Client,
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  assertNoError(error, "메시지 조회");
  return (data ?? []) as ChatMessage[];
}

/**
 * [P5-4b] 프로젝트 → 그 프로젝트를 만든 대화 (FR-025).
 *
 * 대시보드에서 "이어서 수정"으로 들어갈 문을 열어주기 위한 것.
 * 프로젝트마다 따로 묻지 않고 한 번에 찾는다(N+1 방지).
 */
export async function findConversationsByProjects(
  client: Client,
  projectIds: string[],
  ownerId: string,
): Promise<Record<string, string>> {
  if (projectIds.length === 0) return {};

  const { data, error } = await client
    .from("conversations")
    .select("id, project_id")
    .eq("owner_id", ownerId)
    .in("project_id", projectIds);

  assertNoError(error, "프로젝트의 대화 조회");

  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; project_id: string | null }[]) {
    if (row.project_id) map[row.project_id] = row.id;
  }
  return map;
}

/** [P4-3] 이 대화로 만들어진 프로젝트를 연결한다. */
export async function setConversationProject(
  client: Client,
  conversationId: string,
  ownerId: string,
  projectId: string,
): Promise<void> {
  const { error } = await client
    .from("conversations")
    .update({ project_id: projectId })
    .eq("id", conversationId)
    .eq("owner_id", ownerId)
    .select("id")
    .single();

  assertNoError(error, "프로젝트 연결");
}

export async function setCurrentBlock(
  client: Client,
  conversationId: string,
  ownerId: string,
  block: BlockId,
): Promise<void> {
  const { error } = await client
    .from("conversations")
    .update({ current_block: block })
    .eq("id", conversationId)
    .eq("owner_id", ownerId)
    .select("id")
    .single();

  assertNoError(error, "진행 단계 저장");
}
