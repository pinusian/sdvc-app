import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P3-7] 슬라이스 2(SDVC 엔진) 종단간 검증.
 *
 * 두 갈래로 나눴다.
 * ① 화면 동작(스트리밍 표시·승인 게이트·마커 감추기)은 `/api/chat` 응답을
 *    가짜 NDJSON으로 대신해 검증한다. Anthropic 호출은 **서버**가 하므로
 *    브라우저 쪽 route 가로채기로는 잡히지 않는다 — 그래서 우리 API를 막는다.
 * ② 저장·복원은 진짜 DB에 넣은 대화를 열어 확인한다.
 *
 * 실제 Claude 응답으로 진행대본이 지켜지는지(헌장→명세→명확화→계획,
 * 헌장 점검표, 승인 선택지)는 [P3-7]에서 브라우저로 직접 확인했고
 * 그 증거는 docs/progress.md에 남겼다.
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
  const email = `${localPart}+p37-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${domain}`;
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

/** `/api/chat`이 흘려보낼 NDJSON 이벤트를 대신 돌려준다. */
async function stubChat(page: Page, events: unknown[]) {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
}

test.describe("[P3-7] 슬라이스 2 — 대화 화면", () => {
  test("답변이 이어붙어 보이고, 승인 버튼으로 다음 블록으로 넘어간다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser();

    try {
      await login(page, email, password);

      await stubChat(page, [
        { type: "thinking" },
        { type: "text", text: "헌장을 정해볼까요? " },
        { type: "text", text: "네 가지를 추천드립니다." },
        { type: "gate", block: "constitution_specify" },
        { type: "done" },
      ]);

      await page.getByRole("button", { name: /새 프로젝트/ }).click();
      await expect(page).toHaveURL(/\/conversations\//, { timeout: 30_000 });
      await expect(page.getByText(/블록 1 \/ 5/)).toBeVisible();

      await page.getByLabel("메시지").fill("홈페이지 만들고 싶어");
      await page.getByRole("button", { name: "보내기" }).click();

      await expect(
        page.getByText("헌장을 정해볼까요? 네 가지를 추천드립니다."),
      ).toBeVisible({ timeout: 15_000 });
      // 승인 마커는 화면에 새어나오지 않는다
      await expect(page.getByText(/SDVC_GATE/)).toHaveCount(0);

      // 승인하면 서버가 알려준 새 블록으로 표시가 바뀐다
      await stubChat(page, [
        { type: "block", block: "clarify" },
        { type: "text", text: "명확화 질문 5가지입니다." },
        { type: "done" },
      ]);
      await page.getByRole("button", { name: /예, 이대로 진행/ }).click();
      await expect(page.getByText(/블록 2 \/ 5/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /예, 이대로 진행/ })).toHaveCount(0);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("저장된 대화는 새로 들어가도 그대로 보인다", async ({ page }) => {
    const { admin, email, password, userId } = await createTestUser();

    try {
      const { data: conversation, error } = await admin
        .from("conversations")
        .insert({ owner_id: userId, current_block: "plan" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await admin.from("messages").insert([
        { conversation_id: conversation.id, role: "user", content: "홈페이지 만들고 싶어" },
        { conversation_id: conversation.id, role: "assistant", content: "이런 계획을 제안합니다." },
      ]);

      await login(page, email, password);
      await page.goto(`/conversations/${conversation.id}`);

      await expect(page.getByText(/블록 3 \/ 5/)).toBeVisible();
      await expect(page.getByText("홈페이지 만들고 싶어")).toBeVisible();
      await expect(page.getByText("이런 계획을 제안합니다.")).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("남의 대화는 열 수 없다", async ({ page }) => {
    const owner = await createTestUser();
    const stranger = await createTestUser();

    try {
      const { data, error } = await owner.admin
        .from("conversations")
        .insert({ owner_id: owner.userId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await login(page, stranger.email, stranger.password);
      const res = await page.goto(`/conversations/${data.id}`);
      expect(res?.status()).toBe(404);
    } finally {
      await owner.admin.auth.admin.deleteUser(owner.userId);
      await stranger.admin.auth.admin.deleteUser(stranger.userId);
    }
  });
});
