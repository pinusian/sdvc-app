import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P7-1b] 프로젝트 이름 지정·변경 (FR-030, BL-002).
 *
 * 전에는 모든 프로젝트가 "내 프로젝트"라 목록에서 구분이 안 됐다.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function createTestUser(tag: string) {
  const admin = adminClient();
  const [localPart, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${localPart}+${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
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

test("[P7-1b] 새 프로젝트를 이름과 함께 시작한다", async ({ page }) => {
  const { admin, email, password, userId } = await createTestUser("p71b-new");

  try {
    await login(page, email, password);

    await page.getByRole("button", { name: /새 프로젝트/ }).click();
    await page.getByLabel("프로젝트 이름").fill("소금빵 가게");
    await page.getByRole("button", { name: "시작하기" }).click();

    await expect(page).toHaveURL(/\/conversations\//, { timeout: 20_000 });

    const { data: conversations } = await admin
      .from("conversations")
      .select("title")
      .eq("owner_id", userId);
    expect(conversations?.[0]?.title).toBe("소금빵 가게");
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});

test("[P7-1b] 이름을 비워도 시작할 수 있다", async ({ page }) => {
  const { admin, email, password, userId } = await createTestUser("p71b-blank");

  try {
    await login(page, email, password);

    await page.getByRole("button", { name: /새 프로젝트/ }).click();
    await expect(page.getByText(/비워두면/)).toBeVisible();
    await page.getByRole("button", { name: "시작하기" }).click();

    await expect(page).toHaveURL(/\/conversations\//, { timeout: 20_000 });
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});

test("[P7-1b] 대시보드에서 이름을 바꾸면 저장된다", async ({ page }) => {
  const { admin, email, password, userId } = await createTestUser("p71b-rename");

  try {
    const { data: project } = await admin
      .from("projects")
      .insert({
        owner_id: userId,
        name: "내 프로젝트",
        slug: `p71b-${Date.now().toString(36)}`,
        status: "deployed",
      })
      .select("id")
      .single();

    await login(page, email, password);
    // 대시보드 제목(h1)도 "내 프로젝트"다 — 카드 제목(h2)을 집는다
    await expect(page.getByRole("heading", { level: 2, name: "내 프로젝트" })).toBeVisible();

    await page.getByRole("button", { name: "이름 바꾸기" }).click();
    const input = page.getByLabel("프로젝트 이름");
    await input.fill("우리 동네 빵집");

    const saved = page.waitForResponse(
      (res) => res.url().includes(`/api/projects/${project!.id}`) && res.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "저장" }).click();
    await saved;

    await expect(page.getByRole("heading", { level: 2, name: "우리 동네 빵집" })).toBeVisible();

    const { data: after } = await admin
      .from("projects")
      .select("name")
      .eq("id", project!.id)
      .single();
    expect(after?.name).toBe("우리 동네 빵집");

    // 새로고침해도 남아 있어야 한다
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "우리 동네 빵집" })).toBeVisible();
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});
