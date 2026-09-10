import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P5-1] `/site/{주소}` — 만들어진 홈페이지를 실제로 보여주는 통로.
 *
 * 저장소는 잠겨 있으므로 서버가 공개범위를 확인한 뒤 파일을 대신 내보낸다.
 */

const getUser = vi.fn();
const getProjectBySlug = vi.fn();
const download = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ storage: { from: () => ({ download }) } }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectBySlug: (...args: unknown[]) => getProjectBySlug(...args),
}));

const PROJECT = {
  id: "proj-1",
  ownerId: "owner-1",
  name: "내 홈페이지",
  slug: "my-homepage",
  visibility: "link" as const,
  status: "deployed" as const,
};

function request(url = "http://localhost:3000/site/my-homepage") {
  return new Request(url);
}

function context(slug = "my-homepage", path?: string[]) {
  return { params: Promise.resolve({ slug, path }) };
}

function fileBlob(content: string, type = "text/html") {
  return new Blob([content], { type });
}

describe("[P5-1] GET /site/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    getProjectBySlug.mockResolvedValue(PROJECT);
    download.mockResolvedValue({ data: fileBlob("<h1>안녕</h1>"), error: null });
  });

  it("주소만 주면 index.html을 보여준다", async () => {
    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.status).toBe(200);
    expect(download).toHaveBeenCalledWith("proj-1/index.html");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<h1>안녕</h1>");
  });

  it("하위 경로 파일도 알맞은 종류로 내보낸다", async () => {
    download.mockResolvedValue({ data: fileBlob("body{}", "text/css"), error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context("my-homepage", ["css", "style.css"]));

    expect(download).toHaveBeenCalledWith("proj-1/css/style.css");
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("확장자 없는 경로는 그 폴더의 index.html을 찾아본다", async () => {
    download
      .mockResolvedValueOnce({ data: null, error: { message: "Object not found" } })
      .mockResolvedValueOnce({ data: fileBlob("<h1>소개</h1>"), error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context("my-homepage", ["about"]));

    expect(download).toHaveBeenNthCalledWith(1, "proj-1/about");
    expect(download).toHaveBeenNthCalledWith(2, "proj-1/about/index.html");
    expect(res.status).toBe(200);
  });

  it("없는 주소는 404", async () => {
    getProjectBySlug.mockResolvedValue(null);

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context("없는주소"));

    expect(res.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("없는 파일도 404", async () => {
    download.mockResolvedValue({ data: null, error: { message: "Object not found" } });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context("my-homepage", ["missing.html"]));

    expect(res.status).toBe(404);
  });

  it("비공개 프로젝트는 남에게 404로 감춘다 (있다는 사실조차 알리지 않는다)", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "private" });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("비공개 프로젝트라도 주인은 볼 수 있다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "private" });
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.status).toBe(200);
  });

  it("경로에 ..가 들어오면 거부한다", async () => {
    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context("my-homepage", ["..", "other", "index.html"]));

    expect(res.status).toBe(400);
    expect(download).not.toHaveBeenCalled();
  });

  it("링크 공개는 검색에 노출되지 않게 한다", async () => {
    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("전체 공개는 검색 노출을 막지 않는다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "public" });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("비공개 산출물은 캐시에 남기지 않는다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "private" });
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
