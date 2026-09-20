import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P2-9] 슬라이스 1(로그인·인증) 종단간 검증.
 *
 * 계정 준비는 Supabase 관리자 API(admin.createUser)로 한다 — 일반
 * 가입(auth.signUp)과 달리 확인 메일을 보내지 않으므로, Supabase
 * 무료 플랜의 낮은 이메일 발송 한도("email rate limit exceeded")에
 * 걸리지 않는다. 실제 가입 폼(이메일 발송 포함) 자체의 동작은
 * [P2-8]에서 실제 Gmail 계정으로 수동 검증했고, [P2-5] 단위 테스트가
 * signUp 호출 자체를 회귀 검증한다.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function createTestUser(emailConfirmed: boolean) {
  const admin = adminClient();
  const [localPart, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${localPart}+p29-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
  const password = "TestPass123!";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: emailConfirmed,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");

  return { admin, email, password, userId: data.user.id };
}

test.describe("[P2-9] 슬라이스 1 — 로그인·인증", () => {
  test("이메일 형식이 잘못되면 Supabase를 부르지 않고 화면에 검증 오류가 뜬다", async ({
    page,
  }) => {
    // 브라우저 기본 type="email" 검증은 "@"만 있으면 통과시키므로, 점(.) 없는
    // 도메인으로 그 검증은 통과시키고 우리 서버 쪽 정규식(validateSignupInput)에서
    // 걸리게 한다.
    await page.goto("/signup");
    await page.getByLabel("이메일").fill("test@invalid");
    await page.getByLabel(/비밀번호/).fill("TestPass123!");
    await page.getByRole("button", { name: "가입하기" }).click();

    await expect(page.getByText("올바른 이메일 주소를 입력해주세요.")).toBeVisible();
  });

  test("이메일 미인증 계정은 로그인이 차단된다 (FR-021)", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser(false);

    try {
      await page.goto("/login");
      await page.getByLabel("이메일").fill(email);
      await page.getByLabel("비밀번호").fill(password);
      await page.getByRole("button", { name: "로그인" }).click();

      await expect(page.getByText(/not confirmed/i)).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("인증된 개발자는 로그인 → 대시보드 → 로그아웃까지 된다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser(true);

    try {
      await page.goto("/login");
      await page.getByLabel("이메일").fill(email);
      await page.getByLabel("비밀번호").fill(password);
      await page.getByRole("button", { name: "로그인" }).click();

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByText("체험 등급")).toBeVisible();
      await expect(page.getByText("아직 만든 프로젝트가 없어요.")).toBeVisible();

      await page.getByRole("button", { name: "로그아웃" }).click();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("로그인하지 않으면 대시보드 대신 로그인 화면으로 보낸다", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "수강생 로그인" })).toBeVisible();
  });

  test("로그인하지 않으면 대화와 계정 제한 화면도 로그인 화면으로 보낸다", async ({
    page,
  }) => {
    for (const path of ["/conversations/not-a-real-id", "/account-restricted"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { name: "수강생 로그인" })).toBeVisible();
    }
  });
});
