import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P7-8] POST /api/attachments — 프롬프트에 붙일 파일 올리기 (FR-031, BL-004).
 *
 * 올린 파일은 **비공개 버킷**에 들어가고, 대화에는 id만 실린다.
 * 나중에 서버가 그 id로 원본을 다시 읽는다 — 클라이언트가 보낸 내용을
 * 그대로 모델에게 넘기지 않기 위해서다([P6-5] 가격 id와 같은 원칙).
 */

const getUser = vi.fn();
const getConversation = vi.fn();
const saveAttachment = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/conversations/store", () => ({
  getConversation: (...args: unknown[]) => getConversation(...args),
}));

vi.mock("@/lib/attachments/store", () => ({
  saveAttachment: (...args: unknown[]) => saveAttachment(...args),
}));

const png = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);

function upload(files: { name: string; bytes: Uint8Array }[], conversationId = "conv-1") {
  const form = new FormData();
  form.append("conversationId", conversationId);
  for (const f of files) {
    form.append("files", new File([f.bytes as BlobPart], f.name));
  }
  return new Request("http://localhost:3000/api/attachments", { method: "POST", body: form });
}

describe("[P7-8] POST /api/attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    getConversation.mockResolvedValue({ id: "conv-1", ownerId: "user-1" });
    saveAttachment.mockImplementation(async (_admin, input) => ({
      id: `att-${input.name}`,
      kind: input.kind,
      name: input.name,
    }));
  });

  it("로그인하지 않으면 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(upload([{ name: "a.png", bytes: png() }]));

    expect(res.status).toBe(401);
    expect(saveAttachment).not.toHaveBeenCalled();
  });

  it("남의 대화에는 올릴 수 없다", async () => {
    getConversation.mockResolvedValue(null);

    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(upload([{ name: "a.png", bytes: png() }]));

    expect(res.status).toBe(404);
    expect(saveAttachment).not.toHaveBeenCalled();
  });

  it("올린 파일의 id와 종류를 돌려준다", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(upload([{ name: "a.png", bytes: png() }]));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      attachments: [{ id: "att-a.png", kind: "image", name: "a.png" }],
    });
  });

  it("이름만 이미지인 실행파일은 저장하지 않는다", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, ...new Array(40).fill(0)]);

    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(upload([{ name: "virus.png", bytes: exe }]));

    expect(res.status).toBe(400);
    expect(saveAttachment).not.toHaveBeenCalled();
  });

  it("하나라도 걸리면 통째로 거부한다 — 반만 올라가면 사용자가 헷갈린다", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, ...new Array(40).fill(0)]);

    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(
      upload([
        { name: "good.png", bytes: png() },
        { name: "bad.png", bytes: exe },
      ]),
    );

    expect(res.status).toBe(400);
    expect(saveAttachment).not.toHaveBeenCalled();
  });

  it("6개를 올리면 거부한다", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `a${i}.png`, bytes: png() }));

    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(upload(files));

    expect(res.status).toBe(400);
    expect(saveAttachment).not.toHaveBeenCalled();
  });

  it("파일이 없으면 400", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(upload([]));

    expect(res.status).toBe(400);
  });

  it("소유자와 대화를 함께 넘겨 저장한다 (경로가 섞이지 않게)", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    await POST(upload([{ name: "a.png", bytes: png() }]));

    expect(saveAttachment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerId: "user-1",
        conversationId: "conv-1",
        kind: "image",
        mediaType: "image/png",
      }),
    );
  });
});
