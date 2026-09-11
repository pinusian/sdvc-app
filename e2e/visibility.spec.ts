import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P5-3] 공개범위 설정 종단간 검증 (FR-007).
 * 여기서는 가짜를 쓰지 않는다 — 진짜 DB·Storage·서빙 라우트를 그대로 쓴다.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function createTestUser() {
  const admin = adminClient();
  const [localPart, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${localPart}+p53-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
  const password = "TestPass123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");
  return { admin, email, password, userId: data.user.id };
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("[P5-3] 공개범위", () => {
  test("비공개 → 링크공개로 바꾸면 로그인 없이도 열리고, 되돌리면 즉시 닫힌다", async ({
    page,
    request,
  }) => {
    const { admin, email, password, userId } = await createTestUser();
    const slug = `p53-e2e-${Date.now().toString(36)}`;

    try {
      const { data: project, error } = await admin
        .from("projects")
        .insert({ owner_id: userId, name: "공개범위 테스트", slug, status: "deployed" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await admin.storage
        .from("artifacts")
        .upload(`${project!.id}/index.html`, "<h1>공개 테스트</h1>", {
          contentType: "text/html",
          upsert: true,
        });

      // 로그인 없는 새 컨텍스트로 확인한다 (request는 페이지 쿠키를 쓰지 않음)
      expect((await request.get(`/site/${slug}`)).status()).toBe(404);

      await login(page, email, password);
      await page.getByLabel("공개범위").selectOption("link");
      await expect(page.getByRole("button", { name: /주소 복사/ })).toBeVisible();

      await expect
        .poll(async () => (await request.get(`/site/${slug}`)).status(), { timeout: 10_000 })
        .toBe(200);

      // 되돌리면 바로 닫혀야 한다 (FR-023의 토대)
      await page.getByLabel("공개범위").selectOption("private");
      await expect(page.getByRole("button", { name: /주소 복사/ })).toHaveCount(0);

      await expect
        .poll(async () => (await request.get(`/site/${slug}`)).status(), { timeout: 10_000 })
        .toBe(404);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("남의 프로젝트 공개범위는 바꿀 수 없다", async ({ page, request }) => {
    const owner = await createTestUser();
    const stranger = await createTestUser();

    try {
      const { data: project } = await owner.admin
        .from("projects")
        .insert({
          owner_id: owner.userId,
          name: "남의 프로젝트",
          slug: `p53-other-${Date.now().toString(36)}`,
        })
        .select("id")
        .single();

      await login(page, stranger.email, stranger.password);
      const res = await page.request.patch(`/api/projects/${project!.id}/visibility`, {
        data: { visibility: "public" },
      });
      expect(res.status()).toBe(404);

      const { data: after } = await owner.admin
        .from("projects")
        .select("visibility")
        .eq("id", project!.id)
        .single();
      expect(after!.visibility).toBe("private"); // 그대로여야 한다

      // 로그인하지 않은 요청도 막힌다
      const anon = await request.patch(`/api/projects/${project!.id}/visibility`, {
        data: { visibility: "public" },
      });
      expect(anon.status()).toBe(401);
    } finally {
      await owner.admin.auth.admin.deleteUser(owner.userId);
      await stranger.admin.auth.admin.deleteUser(stranger.userId);
    }
  });
});
