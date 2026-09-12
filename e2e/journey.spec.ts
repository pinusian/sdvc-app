import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P5-5] MVP 전 구간 여정 — 로그인부터 산출물 열람까지 (★게이트 G5).
 *
 * 자동화하지 않은 두 구간과 그 이유:
 * 1) **실제 가입 폼**: Supabase 무료 플랜의 확인메일 한도에 걸려 반복 실행이
 *    불가능하다(이 테스트를 실가입으로 짰다가 두 번째 실행에서 바로 막혔다).
 *    가입 폼 자체는 [P5-5]에서 사람이 직접 한 번 통과시켰고(프로필·체험등급
 *    자동 생성까지 확인), 입력 검증은 auth.spec.ts가 회귀 검증한다.
 * 2) **실제 Claude 대화**: 매 실행마다 부르면 느리고 비용이 든다. 헌장→명세→
 *    명확화→계획→작업분해→구현까지 실제로 돌려 파일 7개가 만들어지는 것을
 *    [P5-5]에서 확인했다(증거는 docs/progress.md).
 *
 * 나머지 — 로그인 → 대시보드 → 대화 시작 → 공개범위 → 익명 열람 — 은 여기서
 * 진짜 DB·Storage·서빙 라우트로 이어서 검증한다.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

test("[P5-5] 로그인 → 대화 시작 → 공개 → 익명 열람", async ({ page, request }) => {
  const admin = adminClient();
  const [localPart, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${localPart}+g5-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
  const password = "TestPass123!";
  let userId: string | undefined;

  try {
    // 계정 준비: 가입 폼 대신 관리자 API로 만든다(위 주석 참조)
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");
    userId = created.user.id;

    // 가입과 동시에 프로필이 만들어지고 체험 등급이 붙는다
    const { data: profile } = await admin
      .from("profiles")
      .select("role, grade")
      .eq("id", userId)
      .single();
    expect(profile).toMatchObject({ role: "developer", grade: "trial" });

    // 3) 로그인 → 대시보드
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(page.getByText(/체험 등급/)).toBeVisible();

    // 4) 새 프로젝트 → 대화 화면(블록 1)에서 시작한다
    await page.getByRole("button", { name: /새 프로젝트/ }).click();
    // [P7-1b] 이름을 정하는 단계가 생겼다 — 비워도 시작된다 (FR-030)
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(page).toHaveURL(/\/conversations\//, { timeout: 30_000 });
    await expect(page.getByText(/블록 1 \/ 6/)).toBeVisible();

    // 5) 산출물 열람: AI 대신 파일을 직접 올려 서빙 경로를 확인한다
    const slug = `g5-${Date.now().toString(36)}`;
    const { data: project } = await admin
      .from("projects")
      .insert({ owner_id: userId, name: "여정 테스트", slug, status: "deployed" })
      .select("id")
      .single();
    await admin.storage
      .from("artifacts")
      .upload(
        `${project!.id}/index.html`,
        '<html><head><link rel="stylesheet" href="style.css"></head><body><h1>여정</h1></body></html>',
        { contentType: "text/html", upsert: true },
      );
    await admin.storage
      .from("artifacts")
      .upload(`${project!.id}/style.css`, "h1{color:#7fa98c}", {
        contentType: "text/css",
        upsert: true,
      });

    await page.goto("/dashboard");

    // 화면은 먼저 바뀌고 저장은 나중이므로([P5-3] 설계), 저장이 끝난 것을
    // 확인하고 나서 열람을 확인한다. 안 그러면 간헐적으로 404가 난다.
    const saved = page.waitForResponse(
      (res) => res.url().includes("/visibility") && res.request().method() === "PATCH",
    );
    await page.getByLabel("공개범위").selectOption("link");
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("button", { name: /주소 복사/ })).toBeVisible();

    const { data: check } = await admin
      .from("projects")
      .select("visibility")
      .eq("id", project!.id)
      .single();
    expect(check!.visibility).toBe("link");

    // 로그인하지 않은 사람도 볼 수 있어야 한다
    expect((await request.get(`/site/${slug}`)).status()).toBe(200);

    const res = await request.get(`/site/${slug}`);
    expect(res.headers()["content-type"]).toContain("text/html");
    expect(await res.text()).toContain(`<base href="/site/${slug}/">`);
    const css = await request.get(`/site/${slug}/style.css`);
    expect(css.status()).toBe(200);
    expect(css.headers()["content-type"]).toContain("text/css");
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
