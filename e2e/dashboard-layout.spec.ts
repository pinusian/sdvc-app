import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P7-1c] 대시보드 정보 위계 (FR-033, BL-003).
 *
 * 이 화면의 주인공은 **프로젝트 목록**이다. 이용 상태(등급·체험 잔여·사용량)는
 * 알아두면 좋은 부차 정보이므로 목록 아래로 내리고 작게 보여준다.
 *
 * 배치와 크기는 코드를 읽어서는 확인되지 않는다 — 실제로 그려진 값을 잰다.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function setup(page: Page) {
  const admin = adminClient();
  const [localPart, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${localPart}+p71c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
  const password = "TestPass123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");

  await admin.from("projects").insert({
    owner_id: data.user.id,
    name: "우리 동네 빵집",
    slug: `p71c-${Date.now().toString(36)}`,
    status: "deployed",
  });

  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  return { admin, userId: data.user.id };
}

test.describe("[P7-1c] 대시보드 배치", () => {
  test("이용 상태 카드가 프로젝트 목록보다 아래에 있다", async ({ page }) => {
    const { admin, userId } = await setup(page);

    try {
      const status = page.getByRole("progressbar", { name: /사용량/ });
      const projectCard = page.getByRole("heading", { level: 2, name: "우리 동네 빵집" });

      const statusBox = await status.boundingBox();
      const projectBox = await projectCard.boundingBox();

      expect(statusBox).not.toBeNull();
      expect(projectBox).not.toBeNull();
      expect(statusBox!.y).toBeGreaterThan(projectBox!.y);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("글자는 지금의 70%(14px → 10px)로 작다", async ({ page }) => {
    const { admin, userId } = await setup(page);

    try {
      const size = await page
        .getByText(/체험 \d+일 남음/)
        .evaluate((el) => getComputedStyle(el).fontSize);

      expect(size).toBe("10px");
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("세로로도 작아져서 프로젝트 카드보다 낮다", async ({ page }) => {
    const { admin, userId } = await setup(page);

    try {
      // 이용 상태 카드는 progressbar를 담은 section이다
      const statusCard = page.locator("section", {
        has: page.getByRole("progressbar", { name: /사용량/ }),
      });
      const statusBox = await statusCard.boundingBox();

      // 원래 세로 약 97px이었다 — 70%면 70px 아래여야 한다
      expect(statusBox!.height).toBeLessThan(70);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("가로 폭은 프로젝트 카드와 같다", async ({ page }) => {
    const { admin, userId } = await setup(page);

    try {
      const statusCard = page.locator("section", {
        has: page.getByRole("progressbar", { name: /사용량/ }),
      });
      // 프로젝트 카드의 바깥 테두리(Card)를 집는다 — 안쪽 div를 집으면 폭이 다르다
      const projectCard = page
        .locator("div.rounded-lg")
        .filter({ has: page.getByRole("heading", { level: 2, name: "우리 동네 빵집" }) })
        .first();

      const statusBox = await statusCard.boundingBox();
      const projectBox = await projectCard.boundingBox();

      expect(Math.abs(statusBox!.width - projectBox!.width)).toBeLessThanOrEqual(2);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
