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
  _sources: LearnerOverviewSources,
): LearnerOverview[] {
  void _sources;
  throw new Error("T018 learner overview contract is not implemented");
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
  _request: ChangeLearnerAccessRequest,
  _dependencies: ChangeLearnerAccessDependencies,
): Promise<ChangeLearnerAccessResult> {
  void _request;
  void _dependencies;
  throw new Error("T018 learner access contract is not implemented");
}
