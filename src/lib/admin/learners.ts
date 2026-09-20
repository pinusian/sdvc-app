import type { SupabaseClient } from "@supabase/supabase-js";

export type LearnerExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface LearnerProfileSource {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  isActive: boolean;
  suspendedAt: string | null;
}

export interface LearnerProjectSource {
  ownerId: string;
  updatedAt: string;
}

export interface LearnerExecutionSource {
  ownerId: string;
  status: LearnerExecutionStatus;
  updatedAt: string;
}

export interface LearnerUsageSource {
  userId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

export interface LearnerOverview {
  id: string;
  email: string;
  joinedAt: string;
  recentActivityAt: string;
  projectCount: number;
  executionCount: number;
  latestExecutionStatus: LearnerExecutionStatus | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  isActive: boolean;
  suspendedAt: string | null;
}

export interface LearnerOverviewSources {
  profiles: readonly LearnerProfileSource[];
  projects: readonly LearnerProjectSource[];
  executions: readonly LearnerExecutionSource[];
  usage: readonly LearnerUsageSource[];
}

/** T018 RED 계약. T019에서 원천 데이터 집계를 구현한다. */
export function aggregateLearnerOverviews(
  sources: LearnerOverviewSources,
): LearnerOverview[] {
  return sources.profiles
    .filter((profile) => profile.role === "developer")
    .map((profile) => {
      const projects = sources.projects.filter((row) => row.ownerId === profile.id);
      const executions = sources.executions.filter((row) => row.ownerId === profile.id);
      const usage = sources.usage.filter((row) => row.userId === profile.id);
      const latestExecution = executions.reduce<LearnerExecutionSource | null>(
        (latest, row) => (!latest || row.updatedAt > latest.updatedAt ? row : latest),
        null,
      );
      const activityTimes = [
        profile.createdAt,
        ...projects.map((row) => row.updatedAt),
        ...executions.map((row) => row.updatedAt),
        ...usage.map((row) => row.createdAt),
      ];

      return {
        id: profile.id,
        email: profile.email,
        joinedAt: profile.createdAt,
        recentActivityAt: activityTimes.reduce((latest, value) =>
          value > latest ? value : latest,
        ),
        projectCount: projects.length,
        executionCount: executions.length,
        latestExecutionStatus: latestExecution?.status ?? null,
        inputTokens: usage.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: usage.reduce((sum, row) => sum + row.outputTokens, 0),
        costUsd: usage.reduce((sum, row) => sum + row.costUsd, 0),
        isActive: profile.isActive,
        suspendedAt: profile.suspendedAt,
      };
    });
}

interface ProfileRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
  is_active: boolean;
  suspended_at: string | null;
}

interface ProjectRow {
  owner_id: string;
  updated_at: string;
}

interface ConversationRow {
  owner_id: string;
  current_block: string;
  updated_at: string;
}

interface UsageRow {
  user_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
  created_at: string;
}

export interface ListLearnerOverviewOptions {
  search?: string;
  learnerId?: string;
  limit?: number;
}

/** 관리자 전용 Supabase 클라이언트로 수강생 현황 원천을 읽어 집계한다. */
export async function listLearnerOverviews(
  admin: SupabaseClient,
  { search, learnerId, limit = 200 }: ListLearnerOverviewOptions = {},
): Promise<LearnerOverview[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  let profilesQuery = admin
    .from("profiles")
    .select("id, email, role, created_at, is_active, suspended_at")
    .eq("role", "developer")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (learnerId) profilesQuery = profilesQuery.eq("id", learnerId);
  const normalizedSearch = search?.trim();
  if (normalizedSearch) profilesQuery = profilesQuery.ilike("email", `%${normalizedSearch}%`);

  const { data: profileData, error: profileError } = await profilesQuery;
  if (profileError) throw new Error(`수강생 목록 조회 실패: ${profileError.message}`);

  const profiles = (profileData ?? []) as ProfileRow[];
  const learnerIds = profiles.map((row) => row.id);
  if (learnerIds.length === 0) return [];

  const [projectsResult, conversationsResult, usageResult] = await Promise.all([
    admin.from("projects").select("owner_id, updated_at").in("owner_id", learnerIds),
    admin
      .from("conversations")
      .select("owner_id, current_block, updated_at")
      .in("owner_id", learnerIds),
    admin
      .from("usage_logs")
      .select("user_id, input_tokens, output_tokens, cost_usd, created_at")
      .in("user_id", learnerIds),
  ]);

  const sourceError = projectsResult.error ?? conversationsResult.error ?? usageResult.error;
  if (sourceError) throw new Error(`수강생 현황 조회 실패: ${sourceError.message}`);

  return aggregateLearnerOverviews({
    profiles: profiles.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      isActive: row.is_active,
      suspendedAt: row.suspended_at,
    })),
    projects: ((projectsResult.data ?? []) as ProjectRow[]).map((row) => ({
      ownerId: row.owner_id,
      updatedAt: row.updated_at,
    })),
    executions: ((conversationsResult.data ?? []) as ConversationRow[]).map((row) => ({
      ownerId: row.owner_id,
      status: conversationExecutionStatus(row.current_block),
      updatedAt: row.updated_at,
    })),
    usage: ((usageResult.data ?? []) as UsageRow[]).map((row) => ({
      userId: row.user_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: Number(row.cost_usd),
      createdAt: row.created_at,
    })),
  });
}

function conversationExecutionStatus(currentBlock: string): LearnerExecutionStatus {
  if (currentBlock === "done") return "completed";
  if (currentBlock === "implement") return "running";
  return "queued";
}

export type LearnerAccessState = "active" | "suspended";

export interface ChangeLearnerAccessRequest {
  actorId: string;
  learnerId: string;
  nextState: LearnerAccessState;
  reason: string;
  now: string;
}

export interface ChangeLearnerAccessDependencies {
  loadState(learnerId: string): Promise<LearnerAccessState>;
  persistState(input: {
    learnerId: string;
    nextState: LearnerAccessState;
    actorId: string;
    reason: string;
    changedAt: string;
  }): Promise<void>;
  cancelActiveWork(learnerId: string): Promise<number>;
  audit(input: {
    actorId: string;
    learnerId: string;
    reason: string;
    occurredAt: string;
    previousState: LearnerAccessState;
    nextState: LearnerAccessState;
  }): Promise<void>;
}

export interface ChangeLearnerAccessResult {
  previousState: LearnerAccessState;
  nextState: LearnerAccessState;
  changed: boolean;
  cancelledWorkCount: number;
}

/** T018 RED 계약. T020에서 멱등 전이·취소·감사를 구현한다. */
export async function changeLearnerAccess(
  request: ChangeLearnerAccessRequest,
  dependencies: ChangeLearnerAccessDependencies,
): Promise<ChangeLearnerAccessResult> {
  const reason = request.reason.trim();
  if (!reason) throw new Error("차단·해제 사유를 입력해야 합니다.");

  const previousState = await dependencies.loadState(request.learnerId);
  const changed = previousState !== request.nextState;
  let cancelledWorkCount = 0;

  if (changed) {
    await dependencies.persistState({
      learnerId: request.learnerId,
      nextState: request.nextState,
      actorId: request.actorId,
      reason,
      changedAt: request.now,
    });
    if (request.nextState === "suspended") {
      try {
        cancelledWorkCount = await dependencies.cancelActiveWork(request.learnerId);
      } finally {
        await dependencies.audit({
          actorId: request.actorId,
          learnerId: request.learnerId,
          reason,
          occurredAt: request.now,
          previousState,
          nextState: request.nextState,
        });
      }
    } else {
      await dependencies.audit({
        actorId: request.actorId,
        learnerId: request.learnerId,
        reason,
        occurredAt: request.now,
        previousState,
        nextState: request.nextState,
      });
    }
  } else {
    await dependencies.audit({
      actorId: request.actorId,
      learnerId: request.learnerId,
      reason,
      occurredAt: request.now,
      previousState,
      nextState: request.nextState,
    });
  }

  return {
    previousState,
    nextState: request.nextState,
    changed,
    cancelledWorkCount,
  };
}
