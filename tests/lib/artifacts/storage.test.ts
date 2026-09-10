import { describe, expect, it, vi } from "vitest";
import { uploadArtifactFiles, deleteArtifactFiles, contentTypeOf } from "@/lib/artifacts/storage";

/**
 * [P4-3] 산출물 파일을 Storage에 올리고 지우기.
 * Supabase 클라이언트를 주입받아 실제 네트워크 없이 호출 형태를 검증한다.
 */

function fakeStorage(overrides?: {
  uploadError?: { message: string };
  listResults?: Record<string, { name: string; id: string | null }[]>;
  removeError?: { message: string };
}) {
  const uploads: { path: string; content: unknown; options: { contentType?: string } }[] = [];
  const removed: string[][] = [];
  const listed: string[] = [];

  const bucket = {
    upload: vi.fn(async (path: string, content: unknown, options: { contentType?: string }) => {
      uploads.push({ path, content, options });
      return { data: null, error: overrides?.uploadError ?? null };
    }),
    list: vi.fn(async (prefix: string) => {
      listed.push(prefix);
      return { data: overrides?.listResults?.[prefix] ?? [], error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths);
      return { data: null, error: overrides?.removeError ?? null };
    }),
  };

  const client = { storage: { from: vi.fn(() => bucket) } };
  return { client: client as never, bucket, uploads, removed, listed, from: client.storage.from };
}

describe("[P4-3] uploadArtifactFiles", () => {
  it("프로젝트 폴더 아래에 올리고 파일 종류를 알려준다", async () => {
    const { client, uploads, from } = fakeStorage();

    const count = await uploadArtifactFiles(client, "proj-1", [
      { path: "index.html", content: "<h1>안녕</h1>" },
      { path: "css/style.css", content: "body{}" },
    ]);

    expect(count).toBe(2);
    expect(from).toHaveBeenCalledWith("artifacts");
    expect(uploads.map((u) => u.path)).toEqual(["proj-1/index.html", "proj-1/css/style.css"]);
    expect(uploads[0].options.contentType).toBe("text/html; charset=utf-8");
    expect(uploads[1].options.contentType).toBe("text/css; charset=utf-8");
  });

  it("이미 있는 파일은 덮어쓴다 (다시 만들기 지원)", async () => {
    const { client, uploads } = fakeStorage();
    await uploadArtifactFiles(client, "proj-1", [{ path: "index.html", content: "x" }]);
    expect((uploads[0].options as { upsert?: boolean }).upsert).toBe(true);
  });

  it("업로드가 실패하면 조용히 넘어가지 않고 알린다", async () => {
    const { client } = fakeStorage({ uploadError: { message: "quota exceeded" } });

    await expect(
      uploadArtifactFiles(client, "proj-1", [{ path: "index.html", content: "x" }]),
    ).rejects.toThrow(/quota exceeded/);
  });

  it("확장자별 파일 종류를 알려준다", () => {
    expect(contentTypeOf("a.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeOf("a.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeOf("a.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeOf("a.svg")).toBe("image/svg+xml");
    expect(contentTypeOf("a.unknown")).toBe("text/plain; charset=utf-8");
  });
});

describe("[P4-3] deleteArtifactFiles", () => {
  it("하위 폴더까지 훑어 프로젝트 파일을 모두 지운다", async () => {
    const { client, removed } = fakeStorage({
      listResults: {
        "proj-1": [
          { name: "index.html", id: "1" },
          { name: "css", id: null }, // id가 없으면 폴더
        ],
        "proj-1/css": [{ name: "style.css", id: "2" }],
      },
    });

    const count = await deleteArtifactFiles(client, "proj-1");

    expect(count).toBe(2);
    expect(removed.flat().sort()).toEqual(["proj-1/css/style.css", "proj-1/index.html"]);
  });

  it("파일이 없으면 지우기를 부르지 않는다", async () => {
    const { client, bucket } = fakeStorage({ listResults: {} });

    expect(await deleteArtifactFiles(client, "proj-1")).toBe(0);
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("삭제가 실패하면 알린다", async () => {
    const { client } = fakeStorage({
      listResults: { "proj-1": [{ name: "index.html", id: "1" }] },
      removeError: { message: "storage down" },
    });

    await expect(deleteArtifactFiles(client, "proj-1")).rejects.toThrow(/storage down/);
  });
});
