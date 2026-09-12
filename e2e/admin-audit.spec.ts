import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P8-7f] 감사 기록 열람 (FR-017·041).
 *
 * 기록은 [P8-7a]부터 쌓였지만 볼 화면이 없었다 — DB를 직접 열어야만
 * 확인할 수 있었다. 그러니 "화면이 실제로 기록을 보여주는가"는
 * 코드를 읽어서는 알 수 없고 진짜 DB를 지나가 봐야 한다.
 */

const PASSWORD = "TestPass123!";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function makeUser(tag: string, tier: "super" | "support" | null) {
  const admin = adminClient();
  const [local, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${local}+p87${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");

  if (tier) {
    await admin.from("profiles").update({ role: "admin", admin_tier: tier }).eq("id", data.user.id);
  }
  return { admin, email, userId: data.user.id };
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("[P8-7f] 감사 기록", () => {
  test("최고관리자는 자기가 한 일을 이름과 시각으로 확인한다", async ({ page }) => {
    const boss = await makeUser("sup", "super");
    const student = await makeUser("stu", null);

    try {
      await login(page, boss.email);
      await page.goto("/admin");

      // 실제로 한 행위를 하나 만든다 — 화면이 보여줘야 할 바로 그 기록
      await page.getByRole("button", { name: `${student.email} 체험 연장` }).click();
      await expect(page.getByText(/체험을 .*까지로 늘렸습니다/)).toBeVisible({
        timeout: 20_000,
      });

      await page.getByRole("link", { name: "감사 기록" }).click();
      await expect(page).toHaveURL(/\/admin\/audit/);

      // 전체 실행에서 이 시험이 맨 처음 돈다 — dev 서버가 이 화면을 처음
      // 컴파일하느라 기본 5초를 넘길 수 있다. 다른 시험들과 같게 넉넉히 준다.
      const row = page.getByRole("row", { name: /체험 연장/ }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      // UUID가 아니라 사람이 읽는 이메일이어야 한다
      await expect(row.getByText(boss.email)).toBeVisible();
      await expect(row.getByText(student.email)).toBeVisible();
      // 한국 시각 형식 (2026-09-12 22:04)
      await expect(row.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeVisible();
    } finally {
      await boss.admin.auth.admin.deleteUser(boss.userId);
      await student.admin.auth.admin.deleteUser(student.userId);
    }
  });

  test("화면 열람은 기본으로 접히고, 접었다는 사실은 밝힌다", async ({ page }) => {
    const boss = await makeUser("fold", "super");

    try {
      await login(page, boss.email);
      // 콘솔을 세 번 열어 '화면 열람' 기록을 쌓는다
      for (let i = 0; i < 3; i += 1) await page.goto("/admin");

      await page.goto("/admin/audit");
      await expect(page.getByText(/화면 열람 \d+건은 접었습니다/)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("row", { name: /개발자 목록 열람/ })).toHaveCount(0);

      // 켜면 함께 보인다
      await page.getByLabel("화면 열람 포함").check();
      await page.getByRole("button", { name: "걸러보기" }).click();
      await expect(page.getByRole("row", { name: /개발자 목록 열람/ }).first()).toBeVisible();
    } finally {
      await boss.admin.auth.admin.deleteUser(boss.userId);
    }
  });

  test("거부된 시도만 골라볼 수 있다 — 증거로서 가장 중요한 줄이다", async ({ page }) => {
    const boss = await makeUser("den", "super");
    const helper = await makeUser("hlp", "support");

    try {
      // 지원 등급이 감사 기록을 열려다 거부당한다
      const helperPage = await page.context().newPage();
      await login(helperPage, helper.email);
      await helperPage.goto("/admin/audit");
      await expect(helperPage.getByText(/이 등급으로는 감사 기록을 볼 수 없습니다/)).toBeVisible();
      // 지원 등급에게는 링크조차 그리지 않는다
      await expect(helperPage.getByRole("link", { name: "감사 기록" })).toHaveCount(0);
      await helperPage.close();

      await login(page, boss.email);
      await page.goto("/admin/audit?denied=1");

      const denied = page.getByRole("row", { name: /감사 로그 열람/ }).first();
      await expect(denied).toBeVisible();
      await expect(denied.getByText("거부됨")).toBeVisible();
      await expect(denied.getByText(helper.email)).toBeVisible();
      await expect(denied.getByText(/등급 부족/)).toBeVisible();
    } finally {
      await boss.admin.auth.admin.deleteUser(boss.userId);
      await helper.admin.auth.admin.deleteUser(helper.userId);
    }
  });

  test("행위로 좁혀볼 수 있다", async ({ page }) => {
    const boss = await makeUser("flt", "super");
    const student = await makeUser("fst", null);

    try {
      await login(page, boss.email);
      await page.goto("/admin");
      await page.getByRole("button", { name: `${student.email} 체험 연장` }).click();
      await expect(page.getByText(/늘렸습니다/)).toBeVisible({ timeout: 20_000 });

      await page.goto("/admin/audit?action=developer%3Aextend_trial");

      await expect(page.getByRole("row", { name: /체험 연장/ }).first()).toBeVisible();
      await expect(page.getByRole("row", { name: /정책 변경/ })).toHaveCount(0);
    } finally {
      await boss.admin.auth.admin.deleteUser(boss.userId);
      await student.admin.auth.admin.deleteUser(student.userId);
    }
  });

  test("[BL-012] 부여 만료일이 고른 날짜 그대로 저장된다 (UTC로 9시간 밀리지 않는다)", async ({
    page,
  }) => {
    const boss = await makeUser("tz", "super");
    const student = await makeUser("tzs", null);

    try {
      await login(page, boss.email);
      await page.goto("/admin");

      await page.getByRole("button", { name: `${student.email} 등급 부여` }).click();
      await page.getByLabel("부여할 등급").selectOption("basic");
      await page.getByLabel("언제까지").fill("2026-12-31");
      await page.getByRole("button", { name: "부여합니다" }).click();
      await expect(page.getByText("등급을 부여했습니다")).toBeVisible({ timeout: 20_000 });

      const { data } = await boss.admin
        .from("profiles")
        .select("granted_until")
        .eq("id", student.userId)
        .single();

      // 한국 2026-12-31 23:59:59 = 14:59:59Z. 예전에는 23:59:59Z로 저장돼
      // 실제 만료가 한국 2027-01-01 08:59였다.
      expect(new Date(data!.granted_until).toISOString()).toBe("2026-12-31T14:59:59.000Z");

      // 화면에도 고른 날 그대로 뜬다. **그 학생 줄로 좁혀서** 본다 —
      // 다른 계정에도 같은 날짜의 부여가 있을 수 있다.
      const studentRow = page.locator("li").filter({ hasText: student.email });
      await expect(studentRow.getByText(/부여: 기본 \(~2026-12-31\)/)).toBeVisible();
    } finally {
      await boss.admin.auth.admin.deleteUser(boss.userId);
      await student.admin.auth.admin.deleteUser(student.userId);
    }
  });
});
