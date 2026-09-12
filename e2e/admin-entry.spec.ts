import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P8-11e] 관리자 입구 (FR-038·039·040, BL-009).
 *
 * 코드를 읽어서는 확인되지 않는 것들이다: 주소가 그대로 남는지, 관리자가
 * 아닌 사람이 어디로 가는지, 링크가 실제로 그려지는지.
 */

const PASSWORD = "TestPass123!";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** ADMIN_EMAIL과 **다른** 주소를 쓴다 — 같으면 로그인 때 저절로 승격된다 */
async function makeUser(tag: string, promote: boolean) {
  const admin = adminClient();
  const [local, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${local}+p811${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");

  if (promote) {
    await admin
      .from("profiles")
      .update({ role: "admin", admin_tier: "super" })
      .eq("id", data.user.id);
  }

  return { admin, email, userId: data.user.id };
}

async function loginAt(page: Page, path: string, email: string) {
  await page.goto(path);
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
}

test.describe("[P8-11e] 관리자 입구", () => {
  test("로그인 안 한 사람에게 /admin은 주소를 지킨 채 관리자 로그인을 보여준다", async ({
    page,
  }) => {
    await page.goto("/admin");

    // 불만의 핵심: 예전에는 여기서 /login으로 주소가 바뀌었다
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "서버 관리자 로그인" })).toBeVisible();
    await expect(page.getByText("운영 콘솔")).toBeVisible();
    // 관리자는 가입해서 되는 것이 아니다
    await expect(page.getByRole("link", { name: "가입하기" })).toHaveCount(0);
  });

  test("관리자가 /admin에서 로그인하면 바로 콘솔이 열린다", async ({ page }) => {
    const { admin, email, userId } = await makeUser("adm", true);

    try {
      await loginAt(page, "/admin", email);

      await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
      await expect(page.getByText("운영 콘솔")).toBeVisible();
      await expect(page.getByText("최고관리자")).toBeVisible();
      await expect(page.getByRole("link", { name: "개발자 화면" })).toHaveAttribute(
        "href",
        "/dashboard",
      );
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("관리자 화면은 개발자 화면과 반대로 칠해진다 — 한눈에 다른 곳", async ({ page }) => {
    const { admin, email, userId } = await makeUser("clr", true);

    try {
      await loginAt(page, "/admin", email);
      await expect(page.getByText("운영 콘솔")).toBeVisible({ timeout: 20_000 });

      const adminBar = await page
        .locator("header")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);

      await page.getByRole("link", { name: "개발자 화면" }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      const devBar = await page
        .locator("header")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);

      expect(adminBar).not.toBe(devBar);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("관리자가 아닌 사람이 /admin에서 로그인하면 말없이 자기 화면으로 간다", async ({
    page,
  }) => {
    const { admin, email, userId } = await makeUser("dev", false);

    try {
      await loginAt(page, "/admin", email);

      // 404 막다른 길도, "관리자가 아닙니다"도 아니다
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
      await expect(page.getByRole("heading", { name: "내 프로젝트" })).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("자격 없는 계정으로 로그인한 채 /admin에 오면 맨 404가 아니라 지금 누구인지 알려준다", async ({
    page,
  }) => {
    const { admin, email, userId } = await makeUser("who", false);

    try {
      await loginAt(page, "/login", email);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      await page.goto("/admin");

      // 예전에는 여기가 맨 404였다 — 배포가 깨진 것인지 계정이 틀린 것인지 알 수 없었다
      await expect(page.getByText(/not be found|404/i)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "서버 관리자 로그인" })).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByText(/이 계정으로는 운영 콘솔에 들어올 수 없습니다/)).toBeVisible();
      // 콘솔 알맹이는 보이지 않는다
      await expect(page.getByText(/이번 달 수지/)).toHaveCount(0);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("'다른 계정으로 로그인'은 관리자 주소를 잃지 않는다", async ({ page }) => {
    const dev = await makeUser("swp", false);
    const boss = await makeUser("swb", true);

    try {
      await loginAt(page, "/login", dev.email);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      await page.goto("/admin");
      await page.getByRole("button", { name: "다른 계정으로 로그인" }).click();

      // `/login`이 아니라 제자리로 돌아온다
      await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
      await expect(page.getByText(/계정으로 로그인되어 있습니다/)).toHaveCount(0);

      await page.getByLabel("이메일").fill(boss.email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();

      await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
      await expect(page.getByText("최고관리자")).toBeVisible();
    } finally {
      await dev.admin.auth.admin.deleteUser(dev.userId);
      await boss.admin.auth.admin.deleteUser(boss.userId);
    }
  });

  test("대시보드의 서버 관리 입구는 관리자에게만 보인다", async ({ page }) => {
    const boss = await makeUser("lnk", true);
    const dev = await makeUser("nol", false);

    try {
      await loginAt(page, "/login", boss.email);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
      await expect(page.getByRole("link", { name: "서버 관리" })).toHaveAttribute(
        "href",
        "/admin",
      );

      // 눌러서 실제로 콘솔이 열리는지까지 본다 — 링크가 있는 것과 통하는 것은 다르다
      await page.getByRole("link", { name: "서버 관리" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByText("운영 콘솔")).toBeVisible();

      await page.getByRole("button", { name: "로그아웃" }).click();
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

      await loginAt(page, "/login", dev.email);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
      await expect(page.getByRole("link", { name: "서버 관리" })).toHaveCount(0);
    } finally {
      await boss.admin.auth.admin.deleteUser(boss.userId);
      await dev.admin.auth.admin.deleteUser(dev.userId);
    }
  });
});
