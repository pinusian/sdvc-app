import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [BL-014] 프로젝트 개수 한도 (FR-026).
 *
 * `canCreateProject`는 [P6-3]부터 있었지만 아무도 부르지 않았다 — 대시보드는
 * "프로젝트 0 / 1개"라고 알리면서 실제로는 무제한으로 만들 수 있었다.
 *
 * 진짜 DB에 체험 한도(1개)를 채운 계정을 만들고, **구현 단계에서 새 프로젝트를
 * 만들려는 순간**만 402로 막히는지, **Claude를 부르지 않고**(비용 없이) 막히는지,
 * 이미 만든 프로젝트를 고치는 turn은 막히지 않는지를 실제로 확인한다.
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
  const email = `${local}+bl014${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");

  return { admin, email, userId: data.user.id };
}

async function cleanup(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data: projects } = await admin.from("projects").select("id").eq("owner_id", userId);
  for (const p of projects ?? []) {
    for (const bucket of ["artifacts", "versions"]) {
      const { data: files } = await admin.storage.from(bucket).list(p.id);
      if (files?.length) {
        await admin.storage.from(bucket).remove(files.filter((f) => f.id).map((f) => `${p.id}/${f.name}`));
      }
    }
  }
  await admin.auth.admin.deleteUser(userId);
}

test.describe("[BL-014] 프로젝트 개수 한도", () => {
  test("체험 한도(1개)를 채운 계정이 새 프로젝트를 만들려 하면 Claude를 부르지 않고 402로 막힌다", async ({
    page,
  }) => {
    const { admin, email, userId } = await setup("full");

    try {
      // 체험 한도(1개)를 이미 채운 상태를 만든다 — 프로젝트 하나를 이미 가짐
      const { data: project } = await admin
        .from("projects")
        .insert({
          owner_id: userId,
          name: "이미 있는 프로젝트",
          slug: `bl014-full-${Date.now().toString(36)}`,
          status: "deployed",
        })
        .select("id")
        .single();

      // 두 번째 대화(아직 프로젝트 미연결) — 구현 단계까지 와 있다고 가정
      const { data: conv } = await admin
        .from("conversations")
        .insert({ owner_id: userId, title: "두 번째 시도", current_block: "implement" })
        .select("id")
        .single();

      await page.goto("/login");
      await page.getByLabel("이메일").fill(email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      const before = Date.now();
      const res = await page.request.post("/api/chat", {
        data: { conversationId: conv!.id, message: "두 번째 홈페이지도 만들어주세요." },
        timeout: 30_000,
      });
      const elapsed = Date.now() - before;

      expect(res.status()).toBe(402);
      const body = await res.json();
      expect(body.reason).toBe("project_limit");
      expect(body.error).toContain("1개");
      expect(body.upgradeTo).toBe("basic");

      // Claude를 실제로 불렀다면 짧은 인사말에도 5초 이상 걸린다(다른 시험들 참고).
      // 여기서는 dev 서버의 첫 컴파일 지연을 감안해 넉넉히 잡되, 실제 호출과는
      // 확실히 구별되는 값으로 둔다.
      expect(elapsed, `응답까지 ${elapsed}ms — Claude를 부른 것으로 의심됨`).toBeLessThan(7000);

      // 메시지도 저장하지 않았다 — 막힌 요청으로 대화가 지저분해지면 안 된다
      const { data: msgs } = await admin.from("messages").select("id").eq("conversation_id", conv!.id);
      expect(msgs).toHaveLength(0);

      // 첫 번째(이미 있는) 프로젝트는 그대로 살아있다
      const { data: stillThere } = await admin
        .from("projects")
        .select("id")
        .eq("id", project!.id)
        .maybeSingle();
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanup(admin, userId);
    }
  });

  test("한도를 채웠어도 이미 만든 그 프로젝트를 고치는 것은 막히지 않는다", async ({ page }) => {
    const { admin, email, userId } = await setup("edit");

    try {
      const { data: project } = await admin
        .from("projects")
        .insert({
          owner_id: userId,
          name: "고칠 프로젝트",
          slug: `bl014-edit-${Date.now().toString(36)}`,
          status: "deployed",
        })
        .select("id")
        .single();

      await admin.storage.from("artifacts").upload(`${project!.id}/index.html`, "<h1>처음</h1>", {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

      // 이 프로젝트를 만든 바로 그 대화 — 유지보수 중
      const { data: conv } = await admin
        .from("conversations")
        .insert({
          owner_id: userId,
          title: "고칠 프로젝트",
          current_block: "maintenance",
          project_id: project!.id,
        })
        .select("id")
        .single();

      await page.goto("/login");
      await page.getByLabel("이메일").fill(email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      const res = await page.request.post("/api/chat", {
        data: { conversationId: conv!.id, message: "제목만 살짝 바꿔주세요." },
        timeout: 180_000,
      });

      // 한도를 채운 계정이지만, 새 프로젝트를 만드는 게 아니라 **있는 것을 고치는**
      // turn이므로 막히면 안 된다 — 실제로 Claude까지 불려 200이 와야 한다.
      expect(res.status()).toBe(200);
    } finally {
      await cleanup(admin, userId);
    }
  });

  test("프로젝트가 아직 없으면(한도 안) 구현 단계에서도 막히지 않는다", async ({ page }) => {
    const { admin, email, userId } = await setup("ok");

    try {
      const { data: conv } = await admin
        .from("conversations")
        .insert({ owner_id: userId, title: "첫 프로젝트", current_block: "implement" })
        .select("id")
        .single();

      await page.goto("/login");
      await page.getByLabel("이메일").fill(email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      const res = await page.request.post("/api/chat", {
        data: { conversationId: conv!.id, message: "짧게 한 문장만 인사해주세요." },
        timeout: 180_000,
      });

      expect(res.status()).toBe(200);
    } finally {
      await cleanup(admin, userId);
    }
  });
});
