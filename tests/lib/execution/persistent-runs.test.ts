import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelPersistentRun,
  createPersistentRun,
  getPersistentRun,
  resumePersistentRun,
  type PersistentRun,
  type PersistentRunDependencies,
} from "@/lib/execution/persistent-runs";

const NOW = "2026-09-21T01:00:00.000Z";
const RUN: PersistentRun = {
  id: "run-1",
  ownerId: "learner-1",
  projectId: "project-1",
  documentBundleHash: "a".repeat(64),
  idempotencyKey: "project-1:bundle-a",
  status: "running",
  createdAt: NOW,
  updatedAt: NOW,
};

function dependencies(): PersistentRunDependencies {
  return {
    isLearnerActive: vi.fn().mockResolvedValue(true),
    findByIdempotency: vi.fn().mockResolvedValue(null),
    insertRun: vi.fn(async (input) => ({ id: "run-new", ...input })),
    getOwnedRun: vi.fn().mockResolvedValue(RUN),
    listEvents: vi.fn().mockResolvedValue([]),
    requestCancellation: vi.fn(async (_runId, now) => ({
      ...RUN,
      status: "cancel_requested" as const,
      updatedAt: now,
    })),
  };
}

describe("[T032] 지속 작업 생성·중복 방지", () => {
  beforeEach(() => vi.clearAllMocks());

  it("승인 문서 묶음 해시와 멱등키를 결부한 queued 작업을 만든다", async () => {
    const deps = dependencies();
    const input = {
      ownerId: "learner-1",
      projectId: "project-1",
      documentBundleHash: "a".repeat(64),
      idempotencyKey: "project-1:bundle-a",
      now: NOW,
    };

    await expect(createPersistentRun(input, deps)).resolves.toMatchObject({
      ownerId: "learner-1",
      status: "queued",
      documentBundleHash: input.documentBundleHash,
    });
    expect(deps.insertRun).toHaveBeenCalledTimes(1);
  });

  it("같은 사용자의 같은 멱등키는 기존 작업을 돌려주고 중복 생성하지 않는다", async () => {
    const deps = dependencies();
    vi.mocked(deps.findByIdempotency).mockResolvedValue(RUN);

    await expect(
      createPersistentRun(
        {
          ownerId: RUN.ownerId,
          projectId: RUN.projectId,
          documentBundleHash: RUN.documentBundleHash,
          idempotencyKey: RUN.idempotencyKey,
          now: NOW,
        },
        deps,
      ),
    ).resolves.toEqual(RUN);
    expect(deps.insertRun).not.toHaveBeenCalled();
  });

  it("차단·비활성 수강생은 새 작업을 만들 수 없다", async () => {
    const deps = dependencies();
    vi.mocked(deps.isLearnerActive).mockResolvedValue(false);

    await expect(
      createPersistentRun(
        {
          ownerId: "blocked-learner",
          projectId: "project-1",
          documentBundleHash: "a".repeat(64),
          idempotencyKey: "blocked-attempt",
          now: NOW,
        },
        deps,
      ),
    ).rejects.toThrow(/차단|비활성|사용할 수/);
    expect(deps.insertRun).not.toHaveBeenCalled();
  });
});

describe("[T032] 지속 작업 조회·취소·재접속", () => {
  it("소유자만 작업과 순서가 보존된 이벤트를 함께 조회한다", async () => {
    const deps = dependencies();
    vi.mocked(deps.listEvents).mockResolvedValue([
      { id: "event-2", runId: RUN.id, sequence: 2, type: "green", payload: {}, createdAt: NOW },
      { id: "event-1", runId: RUN.id, sequence: 1, type: "red", payload: {}, createdAt: NOW },
    ]);

    const result = await getPersistentRun({ runId: RUN.id, ownerId: RUN.ownerId }, deps);
    expect(result.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(deps.getOwnedRun).toHaveBeenCalledWith(RUN.id, RUN.ownerId);
  });

  it("타 사용자 작업은 존재 여부를 노출하지 않고 찾을 수 없음으로 거부한다", async () => {
    const deps = dependencies();
    vi.mocked(deps.getOwnedRun).mockResolvedValue(null);

    await expect(
      getPersistentRun({ runId: RUN.id, ownerId: "other-learner" }, deps),
    ).rejects.toThrow(/찾을 수/);
    expect(deps.listEvents).not.toHaveBeenCalled();
  });

  it("실행 중 작업의 취소 요청을 영속 상태로 전환한다", async () => {
    const deps = dependencies();
    await expect(
      cancelPersistentRun({ runId: RUN.id, ownerId: RUN.ownerId, now: NOW }, deps),
    ).resolves.toMatchObject({ status: "cancel_requested" });
    expect(deps.requestCancellation).toHaveBeenCalledWith(RUN.id, NOW);
  });

  it("재접속 시 새 작업을 만들지 않고 기존 작업·이벤트를 복원한다", async () => {
    const deps = dependencies();

    await expect(
      resumePersistentRun({ runId: RUN.id, ownerId: RUN.ownerId }, deps),
    ).resolves.toMatchObject({ run: RUN, events: [] });
    expect(deps.insertRun).not.toHaveBeenCalled();
  });

  it("차단된 수강생은 기존 작업도 재개할 수 없다", async () => {
    const deps = dependencies();
    vi.mocked(deps.isLearnerActive).mockResolvedValue(false);

    await expect(
      resumePersistentRun({ runId: RUN.id, ownerId: RUN.ownerId }, deps),
    ).rejects.toThrow(/차단|비활성|재개/);
  });
});
