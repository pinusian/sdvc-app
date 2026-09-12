import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P8-5f] 신고 채널 (FR-013·042·043·044, FR-016).
 *
 * Clarify 17이 경계한 것은 "받아만 두고 아무도 안 보는" 채널이었다.
 * 그러니 여기서 볼 것은 **신고가 접수되는가**가 아니라
 * **신고한 사람이 결과를 보는가**다 — 끝에서 끝까지 지나간다.
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
  const email = `${local}+p85${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

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

async function cleanup(...users: { admin: ReturnType<typeof adminClient>; userId: string }[]) {
  for (const u of users) {
    await u.admin.from("reports").delete().eq("reporter_id", u.userId);
    await u.admin.auth.admin.deleteUser(u.userId);
  }
}

/**
 * 운영자 창은 **반드시 별도 컨텍스트**로 연다.
 * 같은 컨텍스트에서 다른 계정으로 로그인하면 쿠키가 덮어써져
 * 신고자 페이지까지 운영자 것으로 바뀐다 — 결과를 못 보게 된다.
 */
async function opsPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return { page, context };
}

test.describe("[P8-5f] 신고 채널", () => {
  test("신고한 사람이 처리 결과를 본다 — 끝에서 끝까지", async ({ page, browser }) => {
    const dev = await makeUser("dev", null);
    const boss = await makeUser("ops", "super");

    try {
      await login(page, dev.email);

      // 대시보드에서 신고 통로가 보인다
      await page.getByRole("link", { name: "신고하기" }).click();
      await expect(page).toHaveURL(/\/report/);

      await page.getByLabel("무슨 일이 있었나요").fill("대화 도중 화면이 멈춰서 더 진행되지 않습니다.");
      await page.getByRole("button", { name: "신고 보내기" }).click();
      await expect(page.getByText("신고를 접수했습니다")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("접수됨")).toBeVisible();
      // 아직 답은 없다
      await expect(page.getByText("운영자 답변")).toHaveCount(0);

      // 운영자가 처리한다
      const { page: ops, context: opsContext } = await opsPage(browser, boss.email);
      await ops.goto("/admin/reports");
      await expect(ops.getByText("대화 도중 화면이 멈춰서")).toBeVisible();

      await ops.getByRole("button", { name: /처리$/ }).first().click();
      await ops.getByLabel("처리 상태").selectOption("resolved");
      await ops.getByLabel("답변").fill("고쳤습니다. 새로고침 후 다시 시도해주세요.");
      await ops.getByRole("button", { name: "저장" }).click();
      await expect(ops.getByText("처리했습니다")).toBeVisible({ timeout: 20_000 });
      await opsContext.close();

      // 신고한 사람이 결과를 본다 — 이것이 이 기능의 전부다
      await page.reload();
      await expect(page.getByText("처리 완료")).toBeVisible();
      await expect(page.getByText("운영자 답변")).toBeVisible();
      await expect(page.getByText("고쳤습니다. 새로고침 후 다시 시도해주세요.")).toBeVisible();
    } finally {
      await cleanup(dev, boss);
    }
  });

  test("[FR-016] 산출물 신고를 처리하면 그 홈페이지가 실제로 막힌다", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await makeUser("own", null);
    const dev = await makeUser("rep", null);
    const boss = await makeUser("blk", "super");
    const slug = `p85-${Date.now().toString(36)}`;
    let projectId: string | null = null;

    try {
      // 공개된 산출물 하나 — **파일까지 올린다.** 행만 만들면 서빙할 것이 없어
      // 가리기 전에도 404라서, 가려서 404가 된 것인지 구별할 수 없다.
      const { data: project } = await owner.admin
        .from("projects")
        .insert({
          owner_id: owner.userId,
          name: "문제의 홈페이지",
          slug,
          status: "deployed",
          visibility: "public",
        })
        .select("id")
        .single();
      projectId = project!.id;

      await owner.admin.storage
        .from("artifacts")
        .upload(`${projectId}/index.html`, "<h1>문제의 홈페이지</h1>", {
          contentType: "text/html; charset=utf-8",
          upsert: true,
        });

      const before = await request.get(`/site/${slug}`);
      expect(before.status()).not.toBe(404);

      // 주소를 적어서 신고한다
      await login(page, dev.email);
      await page.goto("/report");
      await page.getByLabel("무엇에 대한 신고인가요").selectOption("content");
      await page.getByLabel("무슨 일이 있었나요").fill("이 홈페이지에 부적절한 내용이 있습니다.");
      await page
        .getByLabel(/어디서 그랬나요/)
        .fill(`http://localhost:3000/site/${slug}`);
      await page.getByRole("button", { name: "신고 보내기" }).click();
      await expect(page.getByText("신고를 접수했습니다")).toBeVisible({ timeout: 20_000 });

      // 운영자가 가린다
      const { page: ops, context: opsContext } = await opsPage(browser, boss.email);
      await ops.goto("/admin/reports");
      await ops.getByRole("button", { name: /처리$/ }).first().click();
      await ops.getByLabel("처리 상태").selectOption("resolved");
      await ops.getByLabel("답변").fill("확인 후 가렸습니다.");
      await ops.getByLabel(/이 산출물을 가린다/).check();
      await ops.getByRole("button", { name: "저장" }).click();
      await expect(ops.getByText("처리했습니다")).toBeVisible({ timeout: 20_000 });
      await expect(ops.getByText("산출물 가려짐")).toBeVisible();
      await opsContext.close();

      // 실제로 막혔는가 — 지우지 않고 가린다(404)
      const after = await request.get(`/site/${slug}`);
      expect(after.status()).toBe(404);

      // 파일은 지우지 않았다
      const { data: after2 } = await owner.admin
        .from("projects")
        .select("blocked_at, blocked_reason")
        .eq("slug", slug)
        .single();
      expect(after2!.blocked_at).toBeTruthy();
      expect(after2!.blocked_reason).toContain("신고");

      // 가린 것이지 지운 것이 아니다 — 파일은 그대로 있어야 한다
      const { data: files } = await owner.admin.storage.from("artifacts").list(projectId!);
      expect((files ?? []).some((f) => f.name === "index.html")).toBe(true);
    } finally {
      if (projectId) {
        await owner.admin.storage.from("artifacts").remove([`${projectId}/index.html`]);
      }
      await owner.admin.from("projects").delete().eq("slug", slug);
      await cleanup(owner, dev, boss);
    }
  });

  test("지원 등급은 신고를 보되 처리하지 못한다", async ({ page, browser }) => {
    const dev = await makeUser("sd", null);
    const helper = await makeUser("sh", "support");

    try {
      await login(page, dev.email);
      await page.goto("/report");
      await page.getByLabel("무슨 일이 있었나요").fill("지원 등급 권한을 확인하기 위한 신고입니다.");
      await page.getByRole("button", { name: "신고 보내기" }).click();
      await expect(page.getByText("신고를 접수했습니다")).toBeVisible({ timeout: 20_000 });

      const { page: ops, context: opsContext } = await opsPage(browser, helper.email);
      await ops.goto("/admin/reports");

      await expect(ops.getByText("지원 등급 권한을 확인하기 위한 신고입니다.")).toBeVisible();
      await expect(ops.getByRole("button", { name: /처리$/ })).toHaveCount(0);
      await opsContext.close();
    } finally {
      await cleanup(dev, helper);
    }
  });

  test("미처리 신고가 쌓이면 더 보낼 수 없다 — 접수함이 한 사람으로 차지 않게", async ({
    page,
  }) => {
    const dev = await makeUser("max", null);

    try {
      for (let i = 0; i < 5; i += 1) {
        await dev.admin.from("reports").insert({
          reporter_id: dev.userId,
          reporter_email: dev.email,
          category: "bug",
          body: `미리 쌓아둔 신고 ${i} 입니다. 열 자가 넘습니다.`,
        });
      }

      await login(page, dev.email);
      await page.goto("/report");

      await expect(page.getByText(/처리 중인 신고가 5건/)).toBeVisible();
      await expect(page.getByRole("button", { name: "신고 보내기" })).toBeDisabled();
    } finally {
      await cleanup(dev);
    }
  });

  test("짧은 내용은 보내기 전에 막고 이유를 말한다", async ({ page }) => {
    const dev = await makeUser("sht", null);

    try {
      await login(page, dev.email);
      await page.goto("/report");
      await page.getByLabel("무슨 일이 있었나요").fill("이상함");
      await page.getByRole("button", { name: "신고 보내기" }).click();

      await expect(page.locator("form").getByRole("alert")).toContainText("10자");
      await expect(page.getByText("신고를 접수했습니다")).toHaveCount(0);
    } finally {
      await cleanup(dev);
    }
  });
});
