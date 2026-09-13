import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P8-13] 최고관리자의 전체 프로젝트 열람 (FR-045·046).
 *
 * "운영자(최고관리자)는 개발자들이 만든 모든 프로젝트를 유지보수 차원에서
 * 볼 수 있으면 좋겠다"는 요청 그대로. 표를 보여주는 것과 **실제로 그
 * 산출물을 열 수 있는 것**은 다르다 — 대부분의 프로젝트는 기본이 비공개라,
 * 링크만 있고 열람이 막혀 있으면 이 기능은 무용지물이다. 둘 다 진짜 DB·
 * 저장소로 확인한다.
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
  const email = `${local}+p813${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

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

test.describe("[P8-13] 전체 프로젝트 열람", () => {
  test("최고관리자는 개발자 관리 표 아래에서 전체 프로젝트를 보고, 비공개여도 바로보기로 실제 내용을 연다", async ({
    page,
    context,
  }) => {
    const boss = await makeUser("boss", "super");
    const dev = await makeUser("dev", null);
    const slug = `p813-${Date.now().toString(36)}`;

    try {
      const { data: project } = await dev.admin
        .from("projects")
        .insert({
          owner_id: dev.userId,
          name: "학생이 만든 비공개 홈페이지",
          slug,
          status: "deployed",
          visibility: "private",
        })
        .select("id")
        .single();

      await dev.admin.storage
        .from("artifacts")
        .upload(`${project!.id}/index.html`, "<h1>학생이 만든 비공개 홈페이지</h1>", {
          contentType: "text/html; charset=utf-8",
          upsert: true,
        });

      // 남(운영자 아닌 사람)에게는 여전히 404여야 한다 — 바로보기가 아예
      // 공개범위를 무너뜨리는 게 아니라 관리자에게만 예외를 준 것인지 확인.
      const anonBefore = await page.request.get(`/site/${slug}`);
      expect(anonBefore.status()).toBe(404);

      await page.goto("/login");
      await page.getByLabel("이메일").fill(boss.email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      await page.goto("/admin");
      const developerHeading = page.getByRole("heading", { name: /개발자 \d+명/ });
      const table = page.getByRole("table", { name: "전체 프로젝트" });
      await expect(developerHeading).toBeVisible();
      await expect(table).toBeVisible();

      const row = table.getByRole("row", { name: /학생이 만든 비공개 홈페이지/ });
      await expect(row).toBeVisible();
      await expect(row).toContainText(dev.email);
      await expect(row).toContainText("완성");

      // 바로보기는 새 탭 — 관리자가 자기 콘솔 화면을 잃지 않는다
      const [popup] = await Promise.all([
        context.waitForEvent("page"),
        row.getByRole("link", { name: /바로보기/ }).click(),
      ]);
      await popup.waitForLoadState();
      await expect(popup.getByText("학생이 만든 비공개 홈페이지")).toBeVisible();
      expect(popup.url()).toContain(`/site/${slug}`);
      await popup.close();

      // 열람한 사실이 감사 기록에 남는다 (Clarify 20)
      await page.goto("/admin/audit");
      const auditRow = page.getByRole("row", { name: /남의 프로젝트 열람/ }).first();
      await expect(auditRow).toBeVisible();
      await expect(auditRow).toContainText(boss.email);
    } finally {
      await dev.admin.storage.from("artifacts").remove([`${(await dev.admin.from("projects").select("id").eq("slug", slug).single()).data?.id}/index.html`]).catch(() => {});
      await dev.admin.from("projects").delete().eq("slug", slug);
      await boss.admin.auth.admin.deleteUser(boss.userId);
      await dev.admin.auth.admin.deleteUser(dev.userId);
    }
  });

  test("최고관리자가 아니면 전체 프로젝트 표가 아예 없고, 남의 비공개 프로젝트는 여전히 404다", async ({
    page,
  }) => {
    const helper = await makeUser("helper", "support");
    const dev = await makeUser("dev2", null);
    const slug = `p813s-${Date.now().toString(36)}`;

    try {
      const { data: project } = await dev.admin
        .from("projects")
        .insert({
          owner_id: dev.userId,
          name: "다른 학생 프로젝트",
          slug,
          status: "deployed",
          visibility: "private",
        })
        .select("id")
        .single();
      await dev.admin.storage.from("artifacts").upload(`${project!.id}/index.html`, "<h1>x</h1>", {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

      await page.goto("/login");
      await page.getByLabel("이메일").fill(helper.email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      await page.goto("/admin");
      await expect(page.getByRole("table", { name: "전체 프로젝트" })).toHaveCount(0);

      const res = await page.request.get(`/site/${slug}`);
      expect(res.status()).toBe(404);
    } finally {
      await dev.admin.from("projects").delete().eq("slug", slug);
      await helper.admin.auth.admin.deleteUser(helper.userId);
      await dev.admin.auth.admin.deleteUser(dev.userId);
    }
  });
});
