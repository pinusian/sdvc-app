import { describe, expect, it } from "vitest";
import {
  VERSION_BUCKET,
  MAX_VERSIONS,
  nextVersionName,
  saveVersion,
  listVersions,
} from "@/lib/versions/store";

/**
 * [P7-6a] 버전 보관 (FR-012).
 *
 * 지금까지는 고칠 때마다 같은 경로에 덮어써서 **이전 모습이 사라졌다.**
 * 유지보수 기능을 넣은 이상 되돌리기가 짝으로 있어야 한다.
 *
 * 버킷을 `artifacts`와 나누는 이유: 같은 버킷에 두면 `/site/{주소}` 서빙이
 * 한 번만 어긋나도 **옛 버전이 통째로 공개된다.**
 */

function fakeStorage(existing: string[] = []) {
  const calls: { op: string; args: unknown[] }[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async list(prefix: string) {
            calls.push({ op: "list", args: [bucket, prefix] });
            // 실제 Supabase는 **파일에만 id를 붙이고 폴더는 id가 없다.**
            // 그 차이를 대역도 그대로 흉내내야 재귀 탐색이 올바르게 검증된다.
            const under = existing
              .filter((p) => p.startsWith(prefix ? `${prefix}/` : ""))
              .map((p) => p.slice(prefix ? prefix.length + 1 : 0));
            const seen = new Map<string, boolean>();
            for (const rest of under) {
              const head = rest.split("/")[0];
              const isFile = !rest.includes("/");
              if (!seen.has(head) || isFile) seen.set(head, isFile);
            }
            return {
              data: [...seen].map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null })),
              error: null,
            };
          },
          async upload(path: string, body: unknown) {
            calls.push({ op: "upload", args: [bucket, path, body] });
            return { data: { path }, error: null };
          },
          async download(path: string) {
            calls.push({ op: "download", args: [bucket, path] });
            return {
              data: { arrayBuffer: async () => new TextEncoder().encode(`내용:${path}`).buffer },
              error: null,
            };
          },
          async remove(paths: string[]) {
            calls.push({ op: "remove", args: [bucket, paths] });
            return { data: null, error: null };
          },
        };
      },
    },
  };
  return { client: client as never, calls };
}

describe("[P7-6a] 버전 보관", () => {
  it("버킷은 artifacts와 나눈다", () => {
    expect(VERSION_BUCKET).toBe("versions");
    expect(MAX_VERSIONS).toBe(20);
  });

  it("버전 이름은 순서대로 늘어난다", () => {
    expect(nextVersionName([])).toBe("0001");
    expect(nextVersionName(["0001"])).toBe("0002");
    expect(nextVersionName(["0001", "0002", "0010"])).toBe("0011");
  });

  it("지금 파일 전부를 사본으로 남기고 meta.json을 함께 쓴다", async () => {
    const { client, calls } = fakeStorage(["proj-1/index.html", "proj-1/images/hero.png"]);

    const version = await saveVersion(client, {
      projectId: "proj-1",
      request: "빵집 홈페이지 만들어줘",
      now: new Date("2026-09-12T10:00:00.000Z"),
    });

    expect(version).toBe("0001");
    const uploads = calls.filter((c) => c.op === "upload").map((c) => c.args[1]);
    expect(uploads).toContain("proj-1/0001/index.html");
    expect(uploads).toContain("proj-1/0001/images/hero.png");
    expect(uploads).toContain("proj-1/0001/meta.json");
  });

  it("meta.json에 시각과 그때의 요청을 적는다", async () => {
    const { client, calls } = fakeStorage(["proj-1/index.html"]);

    await saveVersion(client, {
      projectId: "proj-1",
      request: "제목을 크게",
      now: new Date("2026-09-12T10:00:00.000Z"),
    });

    const meta = calls.find((c) => c.op === "upload" && String(c.args[1]).endsWith("meta.json"));
    const body = JSON.parse(String(meta!.args[2]));
    expect(body).toEqual({ at: "2026-09-12T10:00:00.000Z", request: "제목을 크게" });
  });

  it("파일이 하나도 없으면 사본을 남기지 않는다", async () => {
    const { client, calls } = fakeStorage([]);

    const version = await saveVersion(client, { projectId: "proj-1", request: "x" });

    expect(version).toBeNull();
    expect(calls.some((c) => c.op === "upload")).toBe(false);
  });

  it("20개를 넘으면 오래된 것부터 지운다", async () => {
    const old = Array.from({ length: 20 }, (_, i) =>
      `proj-1/${String(i + 1).padStart(4, "0")}/index.html`,
    );
    const { client, calls } = fakeStorage(["proj-1/index.html", ...old]);

    await saveVersion(client, { projectId: "proj-1", request: "21번째" });

    const removed = calls.find((c) => c.op === "remove");
    expect(removed).toBeDefined();
    expect(String(removed!.args[1])).toContain("proj-1/0001/");
  });

  it("버전 목록은 최신이 위로 온다", async () => {
    const { client } = fakeStorage([
      "proj-1/0001/index.html",
      "proj-1/0002/index.html",
      "proj-1/0003/index.html",
    ]);

    const versions = await listVersions(client, "proj-1");

    expect(versions.map((v) => v.name)).toEqual(["0003", "0002", "0001"]);
  });
});

/**
 * [P7-6b] 되돌리기 (FR-012).
 *
 * 가장 조심할 것: **그 버전에 없던 파일을 지우는 것.** 남겨두면 옛 화면과
 * 새 파일이 섞여 "되돌렸는데 이상한 상태"가 된다 — 되돌리기의 의미가 없다.
 */
describe("[P7-6b] restoreVersion", () => {
  function storageWith(live: string[], versioned: string[]) {
    const calls: { op: string; args: unknown[] }[] = [];
    const listOf = (paths: string[], prefix: string) => {
      const under = paths
        .filter((p) => p.startsWith(prefix ? `${prefix}/` : ""))
        .map((p) => p.slice(prefix ? prefix.length + 1 : 0));
      const seen = new Map<string, boolean>();
      for (const rest of under) {
        const head = rest.split("/")[0];
        const isFile = !rest.includes("/");
        if (!seen.has(head) || isFile) seen.set(head, isFile);
      }
      return [...seen].map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null }));
    };
    const client = {
      storage: {
        from(bucket: string) {
          const paths = bucket === "versions" ? versioned : live;
          return {
            async list(prefix: string) {
              return { data: listOf(paths, prefix), error: null };
            },
            async download(path: string) {
              return {
                data: { arrayBuffer: async () => new TextEncoder().encode(path).buffer },
                error: null,
              };
            },
            async upload(path: string, body: unknown) {
              calls.push({ op: "upload", args: [bucket, path, body] });
              return { data: { path }, error: null };
            },
            async remove(p: string[]) {
              calls.push({ op: "remove", args: [bucket, p] });
              return { data: null, error: null };
            },
          };
        },
      },
    };
    return { client: client as never, calls };
  }

  it("그 버전의 파일을 산출물 자리로 되돌린다", async () => {
    const { restoreVersion } = await import("@/lib/versions/store");
    const { client, calls } = storageWith(
      ["proj-1/index.html"],
      ["proj-1/0001/index.html", "proj-1/0001/style.css", "proj-1/0001/meta.json"],
    );

    const restored = await restoreVersion(client, { projectId: "proj-1", version: "0001" });

    const uploaded = calls
      .filter((c) => c.op === "upload" && c.args[0] === "artifacts")
      .map((c) => c.args[1]);
    expect(uploaded).toContain("proj-1/index.html");
    expect(uploaded).toContain("proj-1/style.css");
    // meta.json은 우리 기록일 뿐 홈페이지 파일이 아니다
    expect(uploaded).not.toContain("proj-1/meta.json");
    expect(restored.fileCount).toBe(2);
  });

  it("그 버전에 없던 파일은 지운다 (옛 화면과 섞이면 안 된다)", async () => {
    const { restoreVersion } = await import("@/lib/versions/store");
    const { client, calls } = storageWith(
      ["proj-1/index.html", "proj-1/나중에추가.css", "proj-1/images/새사진.png"],
      ["proj-1/0001/index.html"],
    );

    await restoreVersion(client, { projectId: "proj-1", version: "0001" });

    const removed = calls.find((c) => c.op === "remove" && c.args[0] === "artifacts");
    expect(removed).toBeDefined();
    const paths = removed!.args[1] as string[];
    expect(paths).toContain("proj-1/나중에추가.css");
    expect(paths).toContain("proj-1/images/새사진.png");
    expect(paths).not.toContain("proj-1/index.html");
  });

  it("없는 버전이면 아무것도 건드리지 않고 알린다", async () => {
    const { restoreVersion } = await import("@/lib/versions/store");
    const { client, calls } = storageWith(["proj-1/index.html"], []);

    await expect(
      restoreVersion(client, { projectId: "proj-1", version: "9999" }),
    ).rejects.toThrow(/찾을 수 없/);
    expect(calls.some((c) => c.op === "remove")).toBe(false);
    expect(calls.some((c) => c.op === "upload")).toBe(false);
  });
});
