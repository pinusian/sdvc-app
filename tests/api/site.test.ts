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

function request(url = "http://localhost:3000/site/my-homepage/") {
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
    // 기준 경로(<base>)는 심어주되 원래 내용은 그대로 남는다.
    expect(await res.text()).toContain("<h1>안녕</h1>");
  });

  it("[P5-1] HTML에 기준 경로(<base>)를 심어 상대 경로가 깨지지 않게 한다", async () => {
    // 실제로 겪음: /site/my-homepage 에서 <link href="css/style.css">는
    // /site/css/style.css 로 해석돼 CSS가 안 붙었다. Next.js는 앱 전체에서
    // 끝의 /를 떼어내므로 리다이렉트로는 못 고치고, HTML에 기준 경로를 심는다.
    download.mockResolvedValue({
      data: fileBlob('<html><head><title>x</title></head><body></body></html>'),
      error: null,
    });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const body = await (await GET(request(), context())).text();

    expect(body).toContain('<base href="/site/my-homepage/">');
    expect(body.indexOf("<base")).toBeLessThan(body.indexOf("<title>"));
  });

  it("[P5-1] 이미 기준 경로가 있는 HTML은 건드리지 않는다", async () => {
    const html = '<html><head><base href="/somewhere/"><title>x</title></head></html>';
    download.mockResolvedValue({ data: fileBlob(html), error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const body = await (await GET(request(), context())).text();

    expect(body).toBe(html);
  });

  it("[P5-1] HTML이 아닌 파일은 손대지 않는다", async () => {
    download.mockResolvedValue({ data: fileBlob("body{}", "text/css"), error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const body = await (await GET(request(), context("my-homepage", ["style.css"]))).text();

    expect(body).toBe("body{}");
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

  it("[P5-1] 저장소가 종류를 text/plain으로 알려줘도 확장자 기준으로 바로잡는다", async () => {
    // 실제로 겪음: Supabase Storage는 html 파일을 text/plain으로 돌려준다.
    // 그대로 내보내면 브라우저가 홈페이지를 렌더링하지 않고 소스코드를 보여준다.
    download.mockResolvedValue({ data: fileBlob("<h1>안녕</h1>", "text/plain"), error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("[P5-1] 남이 만든 페이지가 우리 로그인 정보에 접근하지 못하게 가둔다", async () => {
    // 산출물은 사용자가 시킨 대로 AI가 만든 코드다. 우리 도메인에서 그대로
    // 실행되면 그 스크립트가 같은 출처의 쿠키·저장소에 손댈 수 있다.
    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    // allow-same-origin을 주면 가두는 의미가 없다.
    expect(csp).not.toContain("allow-same-origin");
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
