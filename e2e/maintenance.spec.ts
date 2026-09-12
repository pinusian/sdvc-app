import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P5-4b] 개발자 모드 — 이미 만든 프로젝트를 이어서 고치기 (FR-025).
 *
 * 실제 Claude가 파일을 고치는 것까지는 [P5-4b] 검증에서 브라우저로 직접
 * 확인했다(제목·글자색 변경이 같은 프로젝트에 덮어써짐). 여기서는 진입점이
 * 제대로 열리는지를 회귀 테스트로 고정한다.
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
  const email = `${localPart}+p54b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
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

test.describe("[P5-4b] 이어서 수정", () => {
  test("대시보드에서 그 프로젝트를 만든 대화로 들어갈 수 있다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser();

    try {
      const { data: project } = await admin
        .from("projects")
        .insert({
          owner_id: userId,
          name: "고칠 홈페이지",
          slug: `p54b-e2e-${Date.now().toString(36)}`,
          status: "deployed",
        })
        .select("id")
        .single();

      const { data: conversation } = await admin
        .from("conversations")
        .insert({
          owner_id: userId,
          title: "고칠 홈페이지",
          current_block: "implement",
          project_id: project!.id,
        })
        .select("id")
        .single();

      await login(page, email, password);

      const link = page.getByRole("link", { name: "이어서 수정" });
      await expect(link).toHaveAttribute("href", `/conversations/${conversation!.id}`);

      await link.click();
      await expect(page).toHaveURL(new RegExp(`/conversations/${conversation!.id}`));
      await expect(page.getByText(/블록 5 \/ 6/)).toBeVisible();
      await expect(page.getByLabel("메시지")).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  /**
   * [P7-4b] 사용자 신고(BL-001): "이어서 수정"에 들어가니 "대화가 끝났습니다"만 뜨고
   * 프롬프트에 무엇을 넣어도 반응이 없었다. 구현을 마친 대화가 `done`으로 굳었기 때문.
   */
  test("[P7-4b] 예전에 done으로 굳은 대화도 유지보수 화면으로 열린다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser();

    try {
      const { data: project } = await admin
        .from("projects")
        .insert({
          owner_id: userId,
          name: "이미 완성한 홈페이지",
          slug: `p74b-e2e-${Date.now().toString(36)}`,
          status: "deployed",
        })
        .select("id")
        .single();

      const { data: conversation } = await admin
        .from("conversations")
        .insert({
          owner_id: userId,
          title: "이미 완성한 홈페이지",
          current_block: "done", // 예전 값 그대로 — 마이그레이션하지 않는다
          project_id: project!.id,
        })
        .select("id")
        .single();

      await login(page, email, password);
      await page.getByRole("link", { name: "이어서 수정" }).click();
      await expect(page).toHaveURL(new RegExp(`/conversations/${conversation!.id}`));

      await expect(page.getByText("대화가 끝났습니다.")).toHaveCount(0);
      await expect(page.getByText(/블록 6 \/ 6/)).toBeVisible();
      await expect(page.getByText(/유지보수/)).toBeVisible();

      // 요청을 실제로 입력할 수 있어야 한다
      const box = page.getByLabel("메시지");
      await expect(box).toBeEnabled();
      await box.fill("제목 글자를 더 크게 해줘");
      await expect(page.getByRole("button", { name: "보내기" })).toBeEnabled();

      // 더 갈 단계가 없으므로 단계 이동 버튼은 없다
      await expect(page.getByRole("button", { name: /다음 단계로/ })).toHaveCount(0);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("대화가 연결되지 않은 프로젝트에는 그 버튼이 없다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser();

    try {
      await admin.from("projects").insert({
        owner_id: userId,
        name: "대화 없는 프로젝트",
        slug: `p54b-nolink-${Date.now().toString(36)}`,
        status: "deployed",
      });

      await login(page, email, password);

      await expect(page.getByText("대화 없는 프로젝트")).toBeVisible();
      await expect(page.getByRole("link", { name: "이어서 수정" })).toHaveCount(0);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
