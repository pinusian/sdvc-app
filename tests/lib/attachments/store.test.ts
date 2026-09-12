import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_BUCKET,
  attachmentPath,
  saveAttachment,
  readAttachment,
} from "@/lib/attachments/store";

/**
 * [P7-8] 첨부 저장소 (FR-031).
 *
 * 비공개 버킷이다 — 올린 사람과 서버만 읽는다. 경로에 소유자와 대화를
 * 함께 넣어 남의 첨부를 실수로도 건드리지 못하게 한다.
 */

function fakeStorage(overrides: Record<string, unknown> = {}) {
  const uploaded: { path: string; contentType?: string }[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, _body: unknown, options: { contentType?: string }) {
            uploaded.push({ path, contentType: options?.contentType });
            return { data: { path }, error: null, ...overrides };
          },
          async download(path: string) {
            return {
              data: { arrayBuffer: async () => new TextEncoder().encode(`내용:${path}`).buffer },
              error: null,
            };
          },
          __bucket: bucket,
        };
      },
    },
  };
  return { client: client as never, uploaded };
}

describe("[P7-8] 첨부 저장소", () => {
  it("버킷 이름은 artifacts와 분리한다", () => {
    expect(ATTACHMENT_BUCKET).toBe("attachments");
  });

  it("경로에 소유자·대화·id가 모두 들어간다", () => {
    const path = attachmentPath({
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-1",
      extension: "png",
    });
    expect(path).toBe("user-1/conv-1/att-1.png");
  });

  it("저장하면 id와 종류를 돌려준다", async () => {
    const { client, uploaded } = fakeStorage();

    const saved = await saveAttachment(client, {
      ownerId: "user-1",
      conversationId: "conv-1",
      name: "사진.png",
      kind: "image",
      mediaType: "image/png",
      extension: "png",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(saved.kind).toBe("image");
    expect(saved.name).toBe("사진.png");
    expect(saved.id).toMatch(/^[0-9a-z-]{8,}$/i);
    expect(uploaded[0].path).toBe(`user-1/conv-1/${saved.id}.png`);
    expect(uploaded[0].contentType).toBe("image/png");
  });

  it("읽을 때도 소유자 경로로만 읽는다", async () => {
    const { client } = fakeStorage();

    const bytes = await readAttachment(client, {
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-1",
      extension: "png",
    });

    expect(new TextDecoder().decode(bytes)).toBe("내용:user-1/conv-1/att-1.png");
  });

  it("저장에 실패하면 조용히 넘어가지 않는다", async () => {
    const client = {
      storage: {
        from: () => ({
          async upload() {
            return { data: null, error: { message: "권한 없음" } };
          },
        }),
      },
    } as never;

    await expect(
      saveAttachment(client, {
        ownerId: "user-1",
        conversationId: "conv-1",
        name: "a.png",
        kind: "image",
        mediaType: "image/png",
        extension: "png",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/권한 없음/);
  });
});

/**
 * [P7-9] 저장된 첨부를 id로 찾아낸다.
 *
 * 클라이언트는 id만 보낸다 — 확장자까지 받으면 경로의 일부를 클라이언트가
 * 정하게 된다. 폴더를 뒤져 우리가 저장한 이름을 직접 찾는다.
 */
describe("[P7-9] resolveAttachment", () => {
  function listing(names: string[]) {
    return {
      storage: {
        from: () => ({
          async list() {
            return { data: names.map((name) => ({ name })), error: null };
          },
        }),
      },
    } as never;
  }

  it("id로 확장자와 종류를 찾아낸다", async () => {
    const { resolveAttachment } = await import("@/lib/attachments/store");
    const found = await resolveAttachment(listing(["att-1.png", "att-2.txt"]), {
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-1",
    });

    expect(found).toEqual({
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-1",
      extension: "png",
      kind: "image",
      mediaType: "image/png",
    });
  });

  it("글파일도 종류를 맞게 돌려준다", async () => {
    const { resolveAttachment } = await import("@/lib/attachments/store");
    const found = await resolveAttachment(listing(["att-2.md"]), {
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-2",
    });

    expect(found).toMatchObject({ kind: "text", mediaType: "text/markdown" });
  });

  it("없는 id면 null — 남의 첨부를 집어갈 수 없다", async () => {
    const { resolveAttachment } = await import("@/lib/attachments/store");
    const found = await resolveAttachment(listing(["att-1.png"]), {
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-999",
    });

    expect(found).toBeNull();
  });

  it("id가 다른 파일의 앞부분과 겹쳐도 헷갈리지 않는다", async () => {
    const { resolveAttachment } = await import("@/lib/attachments/store");
    const found = await resolveAttachment(listing(["att-12.png"]), {
      ownerId: "user-1",
      conversationId: "conv-1",
      id: "att-1",
    });

    expect(found).toBeNull();
  });
});
