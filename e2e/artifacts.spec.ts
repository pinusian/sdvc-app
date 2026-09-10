import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P4-5] 슬라이스 3(산출물 생성·저장) 종단간 검증.
 *
 * Claude 호출은 서버가 하므로 브라우저에서 막을 수 없다([P3-7]과 같은 이유) —
 * 여기서는 `/api/chat` 응답을 대신 돌려주어 **화면 동작**을 보고,
 * 대시보드 목록과 삭제는 **진짜 DB·Storage**를 쓴다.
 *
 * 실제 Claude가 만든 파일이 저장되는 것까지는 [P4-5]에서 브라우저로 직접
 * 확인했고(index.html 1540B, style.css 1063B), 증거는 docs/progress.md에 있다.
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
  const email = `${localPart}+p45-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
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

test.describe("[P4-5] 슬라이스 3 — 산출물", () => {
  test("파일이 저장되면 완성 안내와 주소가 뜬다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser();

    try {
      const { data: conversation } = await admin
        .from("conversations")
        .insert({ owner_id: userId, title: "내 개인 홈페이지", current_block: "implement" })
        .select("id")
        .single();

      await page.route("**/api/chat", async (route) => {
        const events = [
          { type: "text", text: "홈페이지를 만들었습니다." },
          { type: "artifact", slug: "my-test-site", fileCount: 2 },
          { type: "done" },
        ];
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
          body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        });
      });

      await login(page, email, password);
      await page.goto(`/conversations/${conversation!.id}`);
      await page.getByLabel("메시지").fill("만들어줘");
      await page.getByRole("button", { name: "보내기" }).click();

      await expect(page.getByText(/파일 2개/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("/site/my-test-site")).toBeVisible();
      await expect(page.getByRole("link", { name: /열어보기/ })).toHaveAttribute(
        "href",
        "/site/my-test-site",
      );
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("대시보드에서 프로젝트를 보고 지우면 파일까지 사라진다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser();

    try {
      const slug = `p45-${Date.now().toString(36)}`;
      const { data: project, error } = await admin
        .from("projects")
        .insert({ owner_id: userId, name: "지울 홈페이지", slug, status: "deployed" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await admin.storage
        .from("artifacts")
        .upload(`${project!.id}/index.html`, "<h1>지워질 파일</h1>", {
          contentType: "text/html",
          upsert: true,
        });

      await login(page, email, password);
      await expect(page.getByText("지울 홈페이지")).toBeVisible();
      await expect(page.getByText(`/site/${slug}`)).toBeVisible();
      await expect(page.getByText("완성")).toBeVisible();

      // 확인 없이는 지워지지 않는다
      await page.getByRole("button", { name: "삭제" }).click();
      await expect(page.getByText(/정말 지울까요/)).toBeVisible();
      await page.getByRole("button", { name: "아니요" }).click();
      await expect(page.getByText("지울 홈페이지")).toBeVisible();

      await page.getByRole("button", { name: "삭제" }).click();
      await page.getByRole("button", { name: "네, 지울게요" }).click();

      await expect(page.getByText("지울 홈페이지")).toHaveCount(0, { timeout: 15_000 });

      const { data: rows } = await admin.from("projects").select("id").eq("id", project!.id);
      expect(rows).toHaveLength(0);
      const { data: files } = await admin.storage.from("artifacts").list(project!.id);
      expect(files ?? []).toHaveLength(0);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("남의 프로젝트는 지울 수 없다", async ({ page }) => {
    const owner = await createTestUser();
    const stranger = await createTestUser();

    try {
      const { data: project } = await owner.admin
        .from("projects")
        .insert({
          owner_id: owner.userId,
          name: "남의 홈페이지",
          slug: `p45-other-${Date.now().toString(36)}`,
        })
        .select("id")
        .single();

      await login(page, stranger.email, stranger.password);
      const res = await page.request.delete(`/api/projects/${project!.id}`);
      expect(res.status()).toBe(404);

      const { data: rows } = await owner.admin
        .from("projects")
        .select("id")
        .eq("id", project!.id);
      expect(rows).toHaveLength(1); // 그대로 남아 있어야 한다
    } finally {
      await owner.admin.auth.admin.deleteUser(owner.userId);
      await stranger.admin.auth.admin.deleteUser(stranger.userId);
    }
  });
});
