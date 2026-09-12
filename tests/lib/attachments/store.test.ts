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
