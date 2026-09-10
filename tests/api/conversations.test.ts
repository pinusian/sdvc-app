import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P3-4] 대화 생성·조회 API.
 * 채팅 화면([P3-5])이 이 두 개로 대화를 시작하고, 새로고침해도 이어서 볼 수 있다.
 */

const getUser = vi.fn();
const createConversation = vi.fn();
const getConversation = vi.fn();
const listMessages = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/conversations/store", () => ({
  createConversation: (...args: unknown[]) => createConversation(...args),
  getConversation: (...args: unknown[]) => getConversation(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
}));

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loggedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
}

describe("[P3-4] POST /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggedIn();
    createConversation.mockResolvedValue({
      id: "conv-1",
      ownerId: "user-1",
      currentBlock: "constitution_specify",
    });
  });

  it("로그인하지 않으면 401을 반환한다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { POST } = await import("@/app/api/conversations/route");
    const res = await POST(postRequest({}));

    expect(res.status).toBe(401);
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("로그인한 사람 소유로 대화를 만들고 첫 블록을 알려준다", async () => {
    const { POST } = await import("@/app/api/conversations/route");
    const res = await POST(postRequest({ title: "독서기록 앱" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "conv-1",
      currentBlock: "constitution_specify",
    });
    expect(createConversation).toHaveBeenCalledWith(expect.anything(), {
      ownerId: "user-1",
      title: "독서기록 앱",
    });
  });
});

describe("[P3-4] GET /api/conversations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggedIn();
    getConversation.mockResolvedValue({
      id: "conv-1",
      ownerId: "user-1",
      currentBlock: "plan",
    });
    listMessages.mockResolvedValue([{ role: "user", content: "홈페이지 만들고 싶어" }]);
  });

  const context = { params: Promise.resolve({ id: "conv-1" }) };

  it("내 대화면 진행 단계와 메시지를 함께 돌려준다", async () => {
    const { GET } = await import("@/app/api/conversations/[id]/route");
    const res = await GET(new Request("http://localhost:3000/api/conversations/conv-1"), context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "conv-1",
      currentBlock: "plan",
      messages: [{ role: "user", content: "홈페이지 만들고 싶어" }],
    });
  });

  it("남의 대화(또는 없는 대화)면 404를 반환하고 메시지를 읽지 않는다", async () => {
    getConversation.mockResolvedValue(null);

    const { GET } = await import("@/app/api/conversations/[id]/route");
    const res = await GET(new Request("http://localhost:3000/api/conversations/conv-1"), context);

    expect(res.status).toBe(404);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("로그인하지 않으면 401을 반환한다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { GET } = await import("@/app/api/conversations/[id]/route");
    const res = await GET(new Request("http://localhost:3000/api/conversations/conv-1"), context);

    expect(res.status).toBe(401);
    expect(getConversation).not.toHaveBeenCalled();
  });
});
