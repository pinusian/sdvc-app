import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P7-6b] /api/projects/[id]/rollback — 되돌리기 (FR-012).
 *
 * 남의 프로젝트를 되돌릴 수 있으면 남의 홈페이지를 과거로 돌려버릴 수 있다.
 * 공개범위·이름 변경과 같은 소유권 검사를 쓴다.
 */

const getUser = vi.fn();
const getProjectById = vi.fn();
const listVersions = vi.fn();
const restoreVersion = vi.fn();
const saveVersion = vi.fn();
const findConversationsByProjects = vi.fn();
const appendMessage = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectById: (...args: unknown[]) => getProjectById(...args),
}));

vi.mock("@/lib/versions/store", () => ({
  listVersions: (...args: unknown[]) => listVersions(...args),
  restoreVersion: (...args: unknown[]) => restoreVersion(...args),
  saveVersion: (...args: unknown[]) => saveVersion(...args),
}));

vi.mock("@/lib/conversations/store", () => ({
  findConversationsByProjects: (...args: unknown[]) => findConversationsByProjects(...args),
  appendMessage: (...args: unknown[]) => appendMessage(...args),
}));

const context = { params: Promise.resolve({ id: "proj-1" }) };
const PROJECT = { id: "proj-1", ownerId: "user-1", name: "내 홈페이지", slug: "s", status: "deployed" };

const get = () => new Request("http://localhost:3000/api/projects/proj-1/rollback");
const post = (body: unknown) =>
  new Request("http://localhost:3000/api/projects/proj-1/rollback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("[P7-6b] 되돌리기 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getProjectById.mockResolvedValue(PROJECT);
    listVersions.mockResolvedValue([
      { name: "0002", meta: { at: "2026-09-12T11:00:00.000Z", request: "제목 크게" } },
      { name: "0001", meta: { at: "2026-09-12T10:00:00.000Z", request: "빵집 만들어줘" } },
    ]);
    restoreVersion.mockResolvedValue({ fileCount: 2, removedCount: 1 });
    saveVersion.mockResolvedValue("0003");
    findConversationsByProjects.mockResolvedValue({ "proj-1": "conv-1" });
    appendMessage.mockResolvedValue(undefined);
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { GET, POST } = await import("@/app/api/projects/[id]/rollback/route");
    expect((await GET(get(), context)).status).toBe(401);
    expect((await POST(post({ version: "0001" }), context)).status).toBe(401);
    expect(restoreVersion).not.toHaveBeenCalled();
  });

  it("남의 프로젝트는 404", async () => {
    getProjectById.mockResolvedValue(null);

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "0001" }), context);

    expect(res.status).toBe(404);
    expect(restoreVersion).not.toHaveBeenCalled();
  });

  it("버전 목록을 최신부터 돌려준다", async () => {
    const { GET } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await GET(get(), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions.map((v: { name: string }) => v.name)).toEqual(["0002", "0001"]);
    expect(body.versions[0].request).toBe("제목 크게");
  });

  it("되돌리기 전에 지금 상태를 먼저 사본으로 남긴다", async () => {
    const order: string[] = [];
    saveVersion.mockImplementation(async () => {
      order.push("save");
      return "0003";
    });
    restoreVersion.mockImplementation(async () => {
      order.push("restore");
      return { fileCount: 2, removedCount: 0 };
    });

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    await POST(post({ version: "0001" }), context);

    // 지금 상태를 남겨두지 않으면 "되돌리기를 취소"할 수가 없다
    expect(order).toEqual(["save", "restore"]);
  });

  it("되돌리면 몇 개가 바뀌었는지 알려준다", async () => {
    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "0001" }), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "0001", fileCount: 2, removedCount: 1 });
  });

  it("버전 이름이 이상하면 400 (경로를 벗어나지 못하게)", async () => {
    const { POST } = await import("@/app/api/projects/[id]/rollback/route");

    for (const version of ["../다른프로젝트", "0001/..", "", null, 1]) {
      const res = await POST(post({ version }), context);
      expect(res.status, String(version)).toBe(400);
    }
    expect(restoreVersion).not.toHaveBeenCalled();
  });

  it("없는 버전이면 404로 알린다", async () => {
    restoreVersion.mockRejectedValue(new Error("그 버전을 찾을 수 없습니다."));

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "9999" }), context);

    expect(res.status).toBe(404);
  });

  /**
   * [BL-019] 되돌린 뒤 다시 고치면 되돌리기 전 상태가 되살아났다 (FR-012 보강).
   *
   * 되돌리기 직후 실제 파일은 옳았다("오늘의 소금빵"). 그런데 이어서
   * "제목 옆에 안내를 붙여주세요"라고만 요청하자, 모델이 **대화 기록에 남은
   * 되돌리기 이전 이름("단팝빵 가게")**을 되살려 저장했다 — 여러 턴에 걸친
   * 대화가 [BL-018]의 "지금 파일이 기록보다 정확하다"는 프롬프트 안내보다
   * 모델에게 더 강하게 작용했다.
   *
   * 처방: 되돌리기 사실을 **시스템 프롬프트 각주가 아니라 대화 자체**에
   * 남긴다. 모델이 방금 자기 입으로 한 말은 몇 턴 전의 자기 말보다 강하게
   * 작용한다 — 사람이 "그건 없던 일로 하고" 라고 대화 중에 말하는 것과 같다.
   */
  it("이 프로젝트로 이어가는 대화가 있으면 되돌린 사실을 알리는 메시지를 남긴다", async () => {
    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    await POST(post({ version: "0001" }), context);

    expect(findConversationsByProjects).toHaveBeenCalledWith(
      expect.anything(),
      ["proj-1"],
      "user-1",
    );
    expect(appendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: "conv-1",
        role: "assistant",
        content: expect.stringContaining("빵집 만들어줘"),
      }),
    );
  });

  it("이어지는 대화가 없으면 조용히 넘어간다 — 남길 곳이 없다", async () => {
    findConversationsByProjects.mockResolvedValue({});

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "0001" }), context);

    expect(res.status).toBe(200);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("메시지를 남기지 못해도 되돌리기 자체는 성공한다 — 사용자가 원한 건 되돌리기다", async () => {
    appendMessage.mockRejectedValue(new Error("DB 오류"));

    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    const res = await POST(post({ version: "0001" }), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "0001", fileCount: 2, removedCount: 1 });
  });

  it("이후 대화가 이 안내를 신뢰하도록, 이전 요청은 이제 적용되어 있지 않다고 분명히 말한다", async () => {
    const { POST } = await import("@/app/api/projects/[id]/rollback/route");
    await POST(post({ version: "0001" }), context);

    const call = appendMessage.mock.calls[0][1] as { content: string };
    expect(call.content).toMatch(/되돌|이전|더 이상/);
  });
});
