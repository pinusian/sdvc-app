import { describe, expect, it, vi } from "vitest";
import {
  aggregateLearnerOverviews,
  changeLearnerAccess,
  listLearnerOverviews,
  type ChangeLearnerAccessDependencies,
  type LearnerOverviewSources,
} from "@/lib/admin/learners";

const SOURCES: LearnerOverviewSources = {
  profiles: [
    {
      id: "learner-1",
      email: "one@example.com",
      role: "developer",
      createdAt: "2026-09-01T00:00:00.000Z",
      isActive: true,
      suspendedAt: null,
    },
    {
      id: "learner-2",
      email: "two@example.com",
      role: "developer",
      createdAt: "2026-09-02T00:00:00.000Z",
      isActive: false,
      suspendedAt: "2026-09-18T00:00:00.000Z",
    },
    {
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
      createdAt: "2026-08-01T00:00:00.000Z",
      isActive: true,
      suspendedAt: null,
    },
  ],
  projects: [
    { ownerId: "learner-1", updatedAt: "2026-09-10T10:00:00.000Z" },
    { ownerId: "learner-1", updatedAt: "2026-09-11T10:00:00.000Z" },
    { ownerId: "learner-2", updatedAt: "2026-09-12T10:00:00.000Z" },
  ],
  executions: [
    { ownerId: "learner-1", status: "completed", updatedAt: "2026-09-13T10:00:00.000Z" },
    { ownerId: "learner-1", status: "running", updatedAt: "2026-09-14T10:00:00.000Z" },
  ],
  usage: [
    {
      userId: "learner-1",
      inputTokens: 100,
      outputTokens: 40,
      costUsd: 0.01,
      createdAt: "2026-09-15T10:00:00.000Z",
    },
    {
      userId: "learner-1",
      inputTokens: 250,
      outputTokens: 60,
      costUsd: 0.03,
      createdAt: "2026-09-16T10:00:00.000Z",
    },
  ],
};

describe("[T018] 수강생 이용현황 집계 계약", () => {
  it("관리자 계정은 제외하고 원천 데이터와 정확히 일치하는 현황을 만든다", () => {
    expect(aggregateLearnerOverviews(SOURCES)).toEqual([
      {
        id: "learner-1",
        email: "one@example.com",
        joinedAt: "2026-09-01T00:00:00.000Z",
        recentActivityAt: "2026-09-16T10:00:00.000Z",
        projectCount: 2,
        executionCount: 2,
        latestExecutionStatus: "running",
        inputTokens: 350,
        outputTokens: 100,
        costUsd: 0.04,
        isActive: true,
        suspendedAt: null,
      },
      {
        id: "learner-2",
        email: "two@example.com",
        joinedAt: "2026-09-02T00:00:00.000Z",
        recentActivityAt: "2026-09-12T10:00:00.000Z",
        projectCount: 1,
        executionCount: 0,
        latestExecutionStatus: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        isActive: false,
        suspendedAt: "2026-09-18T00:00:00.000Z",
      },
    ]);
  });

  it("활동이 없는 수강생은 가입일을 최근 이용 시각으로 사용한다", () => {
    const empty = aggregateLearnerOverviews({
      profiles: [SOURCES.profiles[0]],
      projects: [],
      executions: [],
      usage: [],
    });

    expect(empty[0].recentActivityAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

function learnerAdmin() {
  const filters: Record<string, unknown[][]> = {};
  const rows: Record<string, Record<string, unknown>[]> = {
    profiles: [
      {
        id: "learner-1",
        email: "one@example.com",
        role: "developer",
        created_at: "2026-09-01T00:00:00.000Z",
        is_active: true,
        suspended_at: null,
      },
    ],
    projects: [{ owner_id: "learner-1", updated_at: "2026-09-11T00:00:00.000Z" }],
    conversations: [
      {
        owner_id: "learner-1",
        current_block: "implement",
        updated_at: "2026-09-12T00:00:00.000Z",
      },
    ],
    usage_logs: [
      {
        user_id: "learner-1",
        input_tokens: 12,
        output_tokens: 8,
        cost_usd: "0.125",
        created_at: "2026-09-13T00:00:00.000Z",
      },
    ],
  };
  const client = {
    from(table: string) {
      filters[table] = [];
      return {
        select() {
          const chain = {
            eq(column: string, value: unknown) {
              filters[table].push(["eq", column, value]);
              return chain;
            },
            ilike(column: string, value: unknown) {
              filters[table].push(["ilike", column, value]);
              return chain;
            },
            in(column: string, value: unknown) {
              filters[table].push(["in", column, value]);
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            then(resolve: (result: unknown) => unknown) {
              return resolve({ data: rows[table], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return { client: client as never, filters };
}

describe("[T019] 관리자 수강생 현황 조회", () => {
  it("역할·검색·상세 조건을 서버 쿼리에 걸고 관련 원천만 집계한다", async () => {
    const { client, filters } = learnerAdmin();

    const rows = await listLearnerOverviews(client, {
      search: " one@ ",
      learnerId: "learner-1",
    });

    expect(filters.profiles).toEqual([
      ["eq", "role", "developer"],
      ["eq", "id", "learner-1"],
      ["ilike", "email", "%one@%"],
    ]);
    expect(filters.projects[0]).toEqual(["in", "owner_id", ["learner-1"]]);
    expect(filters.conversations[0]).toEqual(["in", "owner_id", ["learner-1"]]);
    expect(filters.usage_logs[0]).toEqual(["in", "user_id", ["learner-1"]]);
    expect(rows[0]).toMatchObject({
      projectCount: 1,
      executionCount: 1,
      latestExecutionStatus: "running",
      inputTokens: 12,
      outputTokens: 8,
      costUsd: 0.125,
      recentActivityAt: "2026-09-13T00:00:00.000Z",
    });
  });
});

function accessDependencies(initial: "active" | "suspended") {
  const dependencies: ChangeLearnerAccessDependencies = {
    loadState: vi.fn().mockResolvedValue(initial),
    persistState: vi.fn().mockResolvedValue(undefined),
    cancelActiveWork: vi.fn().mockResolvedValue(2),
    audit: vi.fn().mockResolvedValue(undefined),
  };
  return dependencies;
}

const REQUEST = {
  actorId: "admin-1",
  learnerId: "learner-1",
  nextState: "suspended" as const,
  reason: "정책 위반 반복",
  now: "2026-09-20T00:00:00.000Z",
};

describe("[T018] 수강생 차단·해제 계약", () => {
  it("공백뿐인 사유는 상태 변경 전에 거부한다", async () => {
    const dependencies = accessDependencies("active");

    await expect(
      changeLearnerAccess({ ...REQUEST, reason: "   " }, dependencies),
    ).rejects.toThrow(/사유/);
    expect(dependencies.loadState).not.toHaveBeenCalled();
    expect(dependencies.persistState).not.toHaveBeenCalled();
    expect(dependencies.audit).not.toHaveBeenCalled();
  });

  it("차단하면 활성 작업을 취소하고 이전·이후 상태와 사유를 감사 기록한다", async () => {
    const dependencies = accessDependencies("active");

    await expect(changeLearnerAccess(REQUEST, dependencies)).resolves.toEqual({
      previousState: "active",
      nextState: "suspended",
      changed: true,
      cancelledWorkCount: 2,
    });
    expect(dependencies.persistState).toHaveBeenCalledWith({
      learnerId: "learner-1",
      nextState: "suspended",
      actorId: "admin-1",
      reason: "정책 위반 반복",
      changedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(dependencies.cancelActiveWork).toHaveBeenCalledWith("learner-1");
    expect(dependencies.audit).toHaveBeenCalledWith({
      actorId: "admin-1",
      learnerId: "learner-1",
      reason: "정책 위반 반복",
      occurredAt: "2026-09-20T00:00:00.000Z",
      previousState: "active",
      nextState: "suspended",
    });
  });

  it("이미 차단된 계정의 중복 요청은 멱등이며 작업을 다시 취소하지 않는다", async () => {
    const dependencies = accessDependencies("suspended");

    await expect(changeLearnerAccess(REQUEST, dependencies)).resolves.toEqual({
      previousState: "suspended",
      nextState: "suspended",
      changed: false,
      cancelledWorkCount: 0,
    });
    expect(dependencies.persistState).not.toHaveBeenCalled();
    expect(dependencies.cancelActiveWork).not.toHaveBeenCalled();
    expect(dependencies.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "정책 위반 반복",
        previousState: "suspended",
        nextState: "suspended",
      }),
    );
  });

  it("해제도 사유와 이전·이후 상태를 감사 기록하며 취소는 실행하지 않는다", async () => {
    const dependencies = accessDependencies("suspended");

    await changeLearnerAccess(
      { ...REQUEST, nextState: "active", reason: "운영 검토 완료" },
      dependencies,
    );

    expect(dependencies.cancelActiveWork).not.toHaveBeenCalled();
    expect(dependencies.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "운영 검토 완료",
        previousState: "suspended",
        nextState: "active",
      }),
    );
  });
});
