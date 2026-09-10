import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getProjectBySlug } from "@/lib/projects/store";
import { canViewArtifact } from "@/lib/projects/access";
import { ARTIFACT_BUCKET, contentTypeOf } from "@/lib/artifacts/storage";

/** 확장자로 종류를 알 수 있으면 그 값을, 모르면 null. */
function knownContentType(filePath: string): string | null {
  const fallback = "text/plain; charset=utf-8";
  const guess = contentTypeOf(filePath);
  return guess === fallback && !filePath.endsWith(".txt") ? null : guess;
}

/**
 * [P5-1] 만들어진 홈페이지를 실제로 보여주는 통로.
 *
 *   /site/{주소}                → {프로젝트}/index.html
 *   /site/{주소}/css/style.css  → {프로젝트}/css/style.css
 *   /site/{주소}/about          → about 또는 about/index.html
 *
 * 저장소는 비공개라 아무도 직접 못 읽는다([P4-1]). 서버가 공개범위를
 * 확인한 뒤 파일을 대신 내보낸다 — 그래야 "링크 공개 → 비공개"로 되돌리거나
 * 구독 해지 시 즉시 닫는 것(FR-023)이 실제로 먹힌다.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path = [] } = await context.params;

  const relativePath = safeJoin(path);
  if (relativePath === null) {
    return new Response("잘못된 경로입니다.", { status: 400 });
  }

  const admin = createAdminClient();
  const project = await getProjectBySlug(admin, slug);
  if (!project) return notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 볼 수 없는 사람에게는 "없다"고 답한다. 403으로 답하면 비공개 홈페이지가
  // 존재한다는 사실 자체가 새어나간다.
  if (!canViewArtifact(project, user?.id ?? null)) return notFound();

  const bucket = admin.storage.from(ARTIFACT_BUCKET);
  const candidates = fileCandidates(relativePath);

  for (const candidate of candidates) {
    const { data, error } = await bucket.download(`${project.id}/${candidate}`);
    if (error || !data) continue;

    const headers = responseHeaders(candidate, data.type, project.visibility);

    // HTML이면 기준 경로를 심어준다 (아래 withBaseHref 설명 참조).
    if (headers["content-type"].startsWith("text/html")) {
      const html = withBaseHref(await data.text(), `/site/${slug}/`);
      return new Response(html, { status: 200, headers });
    }

    // Blob을 그대로 Response에 넣으면 런타임에 따라 본문이 "[object Blob]"이
    // 되어버린다(테스트 환경에서 실제로 겪음). 바이트로 바꿔서 넘긴다.
    // 파일 상한이 512KB라 통째로 읽어도 부담이 없다.
    return new Response(await data.arrayBuffer(), { status: 200, headers });
  }

  return notFound();
}

/**
 * HTML의 `<head>` 맨 앞에 `<base href="/site/{주소}/">`를 심는다.
 *
 * 산출물은 `<link href="css/style.css">`처럼 상대 경로를 쓴다. 그런데 우리
 * 주소는 `/site/my-homepage`(끝에 / 없음)라서 브라우저는 이것을
 * `/site/css/style.css`로 잘못 푼다 — 실제로 CSS가 안 붙는 것을 겪었다.
 * Next.js가 앱 전체에서 끝의 /를 떼어내므로 리다이렉트로는 고칠 수 없어,
 * 기준 경로를 알려주는 방식을 쓴다. 이미 `<base>`가 있으면 손대지 않는다.
 */
function withBaseHref(html: string, baseHref: string): string {
  if (/<base\s/i.test(html)) return html;

  const headMatch = html.match(/<head[^>]*>/i);
  const tag = `<base href="${baseHref}">`;
  if (headMatch) {
    const at = headMatch.index! + headMatch[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  // <head>가 없는 조각 HTML이면 맨 앞에 둔다.
  return tag + html;
}

function notFound() {
  return new Response("페이지를 찾을 수 없습니다.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** URL 조각들을 안전한 상대 경로로 합친다. 수상하면 null. */
function safeJoin(segments: string[]): string | null {
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\")) return null;
  }
  return segments.join("/");
}

/** 어떤 파일을 찾아볼지 순서대로. 확장자가 없으면 폴더로 보고 index.html도 시도한다. */
function fileCandidates(relativePath: string): string[] {
  if (relativePath === "") return ["index.html"];

  const last = relativePath.split("/").pop() ?? "";
  if (last.includes(".")) return [relativePath];
  return [relativePath, `${relativePath}/index.html`];
}

function responseHeaders(
  filePath: string,
  blobType: string,
  visibility: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    // 파일 종류는 **확장자로 우리가 판단한다.** Supabase Storage는 html을
    // text/plain으로 돌려주는데(그대로 쓰면 홈페이지가 소스코드로 보인다),
    // 확장자를 모르는 경우에만 저장소가 알려준 값을 쓴다.
    "content-type": knownContentType(filePath) ?? blobType ?? "text/plain; charset=utf-8",

    // 산출물은 사용자 요청으로 AI가 만든 남의 코드다. 우리 도메인에서 그대로
    // 실행되면 그 스크립트가 같은 출처의 로그인 쿠키에 손댈 수 있으므로,
    // sandbox로 별개 출처처럼 가둔다(allow-same-origin은 절대 주지 않는다).
    "content-security-policy": "sandbox allow-scripts allow-forms allow-popups",
    "x-content-type-options": "nosniff",
  };

  // **공용 캐시(CDN)에는 어떤 경우에도 남기지 않는다.**
  // 프로덕션에서 실제로 겪은 문제: 전체공개일 때 CDN이 60초 캐시했는데,
  // 그 사이 비공개로 바꿔도 캐시된 사본이 계속 나갔다. 공개범위는 언제든
  // 바뀌고 구독 해지 시 즉시 닫혀야 하므로(FR-023) 캐시보다 정확함을 택한다.
  // (나중에 트래픽이 문제되면 공개범위 변경 시 캐시를 지우는 방식으로 개선)
  if (visibility === "public") {
    headers["cache-control"] = "private, max-age=0, must-revalidate";
  } else if (visibility === "link") {
    headers["cache-control"] = "private, max-age=0, must-revalidate";
    // 주소를 아는 사람만 보라는 뜻이므로 검색에는 걸리지 않게 한다.
    headers["x-robots-tag"] = "noindex, nofollow";
  } else {
    headers["cache-control"] = "no-store";
    headers["x-robots-tag"] = "noindex, nofollow";
  }

  return headers;
}
