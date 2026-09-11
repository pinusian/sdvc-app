import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P6-8] 요금제·이용상태·구독관리 화면 — 진짜 DB로 이어서 검증한다.
 *
 * 여기서 확인하는 것: 대시보드가 **실제 프로필·사용량**을 근거로 상태를
 * 보여주는가, 요금제 화면이 내 등급을 알아보는가, 결제한 적 없는 사람이
 * 구독 관리를 부르면 막히는가.
 *
 * 실제 결제 자체는 Stripe 테스트 결제로 [P6-6]에서 한 번 통과시켰다.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function createTestUser(admin: ReturnType<typeof adminClient>, tag: string) {
  const [localPart, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${localPart}+${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
  const password = "TestPass123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");
  return { id: data.user.id, email, password };
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL("**/dashboard");
}

test("[P6-8] 체험 중인 사람: 남은 기간·사용량을 보고 요금제로 갈 수 있다", async ({ page }) => {
  const admin = adminClient();
  const user = await createTestUser(admin, "p68-trial");

  try {
    await login(page, user.email, user.password);

    // 체험 잔여일 — 가입 시 7일이 붙는다(FR-008)
    await expect(page.getByText(/체험 \d+일 남음/)).toBeVisible();
    // 사용량은 체험 한도(50만)와 함께
    await expect(page.getByText(/0 \/ 50만 토큰/)).toBeVisible();
    await expect(page.getByText(/프로젝트 0 \/ 1개/)).toBeVisible();
    // 결제 전이므로 구독 관리 버튼은 없다
    await expect(page.getByRole("button", { name: "구독 관리" })).toHaveCount(0);

    // 결제한 적 없는 사람은 포털을 열 수 없다
    const portal = await page.request.post("/api/billing/portal");
    expect(portal.status()).toBe(400);

    await page.getByRole("link", { name: "요금제 보기" }).click();
    await page.waitForURL("**/pricing");
    await expect(page.getByText("이용 중")).toBeVisible(); // 체험 카드
    await expect(page.getByRole("button", { name: "기본으로 시작" })).toBeVisible();
    await expect(page.getByRole("button", { name: "프로로 시작" })).toBeVisible();
  } finally {
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("[P6-8] 구독 중인 사람: 구독 중으로 보이고 상위 등급만 살 수 있다", async ({ page }) => {
  const admin = adminClient();
  const user = await createTestUser(admin, "p68-basic");

  try {
    await admin
      .from("profiles")
      .update({
        grade: "basic",
        subscription_status: "active",
        stripe_customer_id: "cus_test_p68",
      })
      .eq("id", user.id);

    await login(page, user.email, user.password);

    await expect(page.getByText("기본 구독 중")).toBeVisible();
    await expect(page.getByText(/0 \/ 200만 토큰/)).toBeVisible();
    await expect(page.getByRole("button", { name: "구독 관리" })).toBeVisible();
    // 구독 중에는 요금제 보기 버튼을 띄우지 않는다
    await expect(page.getByRole("link", { name: "요금제 보기" })).toHaveCount(0);

    await page.goto("/pricing");
    await expect(page.getByText("이용 중")).toBeVisible(); // 기본 카드
    await expect(page.getByRole("button", { name: "프로로 올리기" })).toBeVisible();
    await expect(page.getByRole("button", { name: /기본으로/ })).toHaveCount(0);
  } finally {
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("[P6-8] 체험이 끝난 사람: 끝났다고 알리고 요금제로 안내한다", async ({ page }) => {
  const admin = adminClient();
  const user = await createTestUser(admin, "p68-expired");

  try {
    await admin
      .from("profiles")
      .update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq("id", user.id);

    await login(page, user.email, user.password);

    await expect(page.getByText(/체험 기간이 끝났습니다/)).toBeVisible();
    await expect(page.getByRole("link", { name: "요금제 보기" })).toBeVisible();
  } finally {
    await admin.auth.admin.deleteUser(user.id);
  }
});
