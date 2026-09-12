import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P5-1] `/site/{주소}` — 만들어진 홈페이지를 실제로 보여주는 통로.
 *
 * 저장소는 잠겨 있으므로 서버가 공개범위를 확인한 뒤 파일을 대신 내보낸다.
 */

const getUser = vi.fn();
const getProjectBySlug = vi.fn();
const download = vi.fn();
const isOwnerSuspended = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({ storage: { from: () => ({ download }) } }),
}));

vi.mock("@/lib/projects/store", () => ({
  getProjectBySlug: (...args: unknown[]) => getProjectBySlug(...args),
}));

vi.mock("@/lib/admin/suspension", () => ({
  isOwnerSuspended: (...args: unknown[]) => isOwnerSuspended(...args),
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
    isOwnerSuspended.mockResolvedValue(false);
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

  it("[P5-1] 공개된 페이지는 우리 로그인 정보에 접근하지 못하게 가둔다", async () => {
    // 남이 만든 산출물을 로그인한 다른 개발자가 열어볼 수 있으므로,
    // 그 스크립트가 같은 출처의 쿠키에 손대지 못하게 가둔다.
    for (const visibility of ["link", "public"] as const) {
      getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility });

      const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
      const csp = (await GET(request(), context())).headers.get("content-security-policy") ?? "";

      expect(csp, visibility).toContain("sandbox");
      // allow-same-origin을 주면 가두는 의미가 없다.
      expect(csp, visibility).not.toContain("allow-same-origin");
    }
  });

  it("[P5-1] 비공개 페이지는 주인 본인만 보므로 가두지 않는다", async () => {
    // 프로덕션에서 실제로 겪음: 가둬두면 그 문서의 요청은 쿠키 없이 나가고,
    // 비공개 산출물은 로그인 확인을 못 해 CSS·JS가 전부 404가 됐다.
    // 비공개는 주인 본인만 보는 자기 코드라 바깥에 노출될 일이 없다.
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "private" });
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBeNull();
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

  it("[P5-1] 어떤 공개범위든 공용 캐시(CDN)에 저장하지 않는다", async () => {
    // 실제 프로덕션에서 겪음: 전체공개일 때 CDN이 60초 캐시한 뒤 비공개로
    // 바꿨는데도 캐시된 사본이 계속 200으로 나갔다(X-Vercel-Cache: HIT).
    // 공개범위는 언제든 바뀌고 해지 시 즉시 닫혀야 하므로(FR-023),
    // 공용 캐시에는 아예 남기지 않는다.
    for (const visibility of ["public", "link", "private"] as const) {
      getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility });
      getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });

      const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
      const cacheControl = (await GET(request(), context())).headers.get("cache-control") ?? "";

      expect(cacheControl, visibility).not.toMatch(/(^|[\s,])public/);
      expect(cacheControl, visibility).toMatch(/no-store|private/);
    }
  });

  it("비공개 산출물은 캐시에 남기지 않는다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "private" });
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

/**
 * [P8-6] 비상 차단·계정 정지 (FR-016·014).
 *
 * **403이 아니라 404** — 존재 자체를 숨긴다([P5-1]과 같은 원칙).
 */
describe("[P8-6] 차단된 산출물", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    download.mockResolvedValue({ data: fileBlob("<h1>안녕</h1>"), error: null });
    isOwnerSuspended.mockResolvedValue(false);
  });

  it("차단된 프로젝트는 404", async () => {
    getProjectBySlug.mockResolvedValue({
      ...PROJECT,
      visibility: "public",
      blockedAt: "2026-09-12T00:00:00.000Z",
    });

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.status).toBe(404);
  });

  it("주인이 정지되면 그 사람의 산출물도 404", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "public" });
    isOwnerSuspended.mockResolvedValue(true);

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.status).toBe(404);
  });

  it("정지가 아니면 평소대로 열린다", async () => {
    getProjectBySlug.mockResolvedValue({ ...PROJECT, visibility: "public" });
    isOwnerSuspended.mockResolvedValue(false);

    const { GET } = await import("@/app/site/[slug]/[[...path]]/route");
    const res = await GET(request(), context());

    expect(res.status).toBe(200);
  });
});
