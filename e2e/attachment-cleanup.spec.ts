import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [BL-015] 첨부 파일이 영영 지워지지 않는다 (FR-031).
 *
 * `deleteConversationAttachments`는 [P7-8]부터 있었지만 아무도 부르지
 * 않았다 — attachments 비공개 버킷이 계속 커지고 있었다. 프로젝트를
 * 지울 때 그 프로젝트를 만든 대화의 첨부까지 실제로 지워지는지, 진짜
 * Storage에 파일을 올려두고 확인한다.
 */

const PASSWORD = "TestPass123!";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function setup(tag: string) {
  const admin = adminClient();
  const [local, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${local}+bl015${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");

  return { admin, email, userId: data.user.id };
}

test("프로젝트를 지우면 그 대화에 붙였던 첨부도 함께 지워진다", async ({ page }) => {
  const { admin, email, userId } = await setup("del");

  const { data: project } = await admin
    .from("projects")
    .insert({
      owner_id: userId,
      name: "첨부 정리 확인",
      slug: `bl015-${Date.now().toString(36)}`,
      status: "deployed",
    })
    .select("id")
    .single();

  const { data: conv } = await admin
    .from("conversations")
    .insert({
      owner_id: userId,
      title: "첨부 정리 확인",
      current_block: "maintenance",
      project_id: project!.id,
    })
    .select("id")
    .single();

  // 실제 첨부 하나를 진짜 저장소에 올려둔다 — attachmentPath와 같은 규칙
  const attachmentPath = `${userId}/${conv!.id}/00000000-0000-0000-0000-000000000000.png`;
  const { error: uploadError } = await admin.storage
    .from("attachments")
    .upload(attachmentPath, Buffer.from("fake-png-bytes"), {
      contentType: "image/png",
      upsert: true,
    });
  expect(uploadError).toBeNull();

  await admin.storage.from("artifacts").upload(`${project!.id}/index.html`, "<h1>x</h1>", {
    contentType: "text/html; charset=utf-8",
    upsert: true,
  });

  try {
    // 올라간 것을 먼저 확인한다 — 지워지기 전 상태
    const before = await admin.storage.from("attachments").list(`${userId}/${conv!.id}`);
    expect(before.data?.some((f) => f.name.endsWith(".png"))).toBe(true);

    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    const res = await page.request.delete(`/api/projects/${project!.id}`);
    expect(res.status()).toBe(200);

    // 실제로 지워졌는가 — 진짜 Storage를 다시 읽는다
    const after = await admin.storage.from("attachments").list(`${userId}/${conv!.id}`);
    expect((after.data ?? []).some((f) => f.name.endsWith(".png"))).toBe(false);
  } finally {
    // 혹시 실패해도 남지 않게 정리
    await admin.storage.from("attachments").remove([attachmentPath]).catch(() => {});
    await admin.auth.admin.deleteUser(userId);
  }
});

test("대화가 없는 프로젝트를 지워도 문제없다", async ({ page }) => {
  const { admin, email, userId } = await setup("noconv");

  const { data: project } = await admin
    .from("projects")
    .insert({
      owner_id: userId,
      name: "대화 없는 프로젝트",
      slug: `bl015-nc-${Date.now().toString(36)}`,
      status: "deployed",
    })
    .select("id")
    .single();

  await admin.storage.from("artifacts").upload(`${project!.id}/index.html`, "<h1>x</h1>", {
    contentType: "text/html; charset=utf-8",
    upsert: true,
  });

  try {
    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    const res = await page.request.delete(`/api/projects/${project!.id}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true });
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});
