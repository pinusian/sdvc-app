import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [P7-12] 고쳤다는 말과 실제로 고쳐졌는가 (SC-008 개정).
 *
 * 원래 SC-008은 "재현 테스트(RED)가 먼저 실행된 기록이 남음"이었으나
 * 정적 HTML에는 테스트 실행기가 없어 지킬 수 없는 말이었다. 대신 같은 고통
 * (BL-001b·BL-005b)을 막는 쪽으로 바꿨다:
 * **말한 변화가 실제 파일에 닿았는지 서버가 확인한다.**
 *
 * 그러니 여기서 볼 것은 "경고 문구가 코드에 있는가"가 아니라
 * **BL-001b 상황을 실제로 만들었을 때 사용자에게 알려지는가**다.
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
  const email = `${local}+p712${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

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
        await admin.storage
          .from(bucket)
          .remove(files.filter((f) => f.id).map((f) => `${p.id}/${f.name}`));
      }
    }
  }
  await admin.auth.admin.deleteUser(userId);
}

test.describe("[P7-12] 고친 것을 실제로 확인한다", () => {
  test("[BL-001b] 고쳤다는데 파일이 하나도 안 나오면 알려준다", async ({ page }) => {
    const { admin, email, userId } = await setup("none");

    try {
      // 이미 배포된 프로젝트 + 유지보수 중인 대화 — BL-001b가 났던 그 상태
      const { data: project } = await admin
        .from("projects")
        .insert({
          owner_id: userId,
          name: "확인용 홈페이지",
          slug: `p712-${Date.now().toString(36)}`,
          status: "deployed",
          visibility: "private",
        })
        .select("id")
        .single();

      const { data: conv } = await admin
        .from("conversations")
        .insert({
          owner_id: userId,
          title: "확인용",
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

      // 파일 블록 없이 "고쳤다"고만 답하게 유도한다 — 모델이 그렇게 답하는
      // 상황을 억지로 만들 수는 없으므로, 파일을 내지 말라고 명시한다.
      const res = await page.request.post("/api/chat", {
        data: {
          conversationId: conv!.id,
          message:
            "아무 파일도 내지 말고, 코드블록도 쓰지 말고, 딱 한 문장으로 " +
            "'말씀하신 부분을 고쳤습니다.'라고만 답해주세요.",
        },
        timeout: 180_000,
      });
      expect(res.status()).toBe(200);

      const body = await res.text();
      // 스트림은 NDJSON — 줄마다 이벤트다
      const events = body
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string; message?: string });

      const answer = events
        .filter((e) => e.type === "text")
        .map((e) => (e as unknown as { text: string }).text)
        .join("");
      const errors = events.filter((e) => e.type === "error").map((e) => e.message ?? "");

      // 모델이 실제로 "고쳤다"고 주장했을 때에만 이 검사가 의미가 있다
      if (/고쳤|수정했|바꿨|반영했/.test(answer)) {
        expect(
          errors.some((m) => m.includes("저장된 파일이 없습니다")),
          `고쳤다고 했는데(${answer.slice(0, 40)}…) 경고가 없었다. 받은 경고: ${JSON.stringify(errors)}`,
        ).toBe(true);
      } else {
        test.info().annotations.push({
          type: "skip-reason",
          description: `모델이 고쳤다고 주장하지 않아 검사 대상이 아님: ${answer.slice(0, 60)}`,
        });
      }
    } finally {
      await cleanup(admin, userId);
    }
  });

  test("파일이 실제로 바뀌면 경고하지 않고, 버전에 무엇이 바뀌었는지 남는다", async ({ page }) => {
    const { admin, email, userId } = await setup("chg");

    try {
      await page.goto("/login");
      await page.getByLabel("이메일").fill(email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      const { data: project } = await admin
        .from("projects")
        .insert({
          owner_id: userId,
          name: "버전 기록 확인",
          slug: `p712v-${Date.now().toString(36)}`,
          status: "deployed",
          visibility: "private",
        })
        .select("id")
        .single();

      await admin.storage
        .from("artifacts")
        .upload(`${project!.id}/index.html`, "<h1>처음</h1>", {
          contentType: "text/html; charset=utf-8",
          upsert: true,
        });

      const { data: conv } = await admin
        .from("conversations")
        .insert({
          owner_id: userId,
          title: "버전 기록",
          current_block: "maintenance",
          project_id: project!.id,
        })
        .select("id")
        .single();

      const res = await page.request.post("/api/chat", {
        data: {
          conversationId: conv!.id,
          message:
            "index.html을 정확히 다음 내용으로 바꿔주세요. 설명은 한 줄만 하세요.\n" +
            "<h1>바뀐 제목</h1>",
        },
        timeout: 180_000,
      });
      expect(res.status()).toBe(200);
      const stream = await res.text();
      const answer = stream
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string; text?: string })
        .filter((e) => e.type === "text")
        .map((e) => e.text ?? "")
        .join("");

      // 실제로 저장됐는가
      const { data: saved } = await admin.storage
        .from("artifacts")
        .download(`${project!.id}/index.html`);
      const html = await saved!.text();
      expect(html, `모델 답변: ${answer.slice(0, 400)}`).not.toBe("<h1>처음</h1>");

      // [SC-008] 버전에 **무엇이 실제로 바뀌었는지** 기록이 남는가
      const { data: versions } = await admin.storage.from("versions").list(project!.id);
      const names = (versions ?? []).map((v) => v.name).filter((n) => /^\d{4}$/.test(n));
      expect(names.length, "버전 사본이 남아야 한다").toBeGreaterThan(0);

      const { data: metaFile } = await admin.storage
        .from("versions")
        .download(`${project!.id}/${names[names.length - 1]}/meta.json`);
      const meta = JSON.parse(await metaFile!.text()) as { changed?: string[]; request: string };

      expect(meta.changed, "무엇이 바뀌었는지 기록이 남아야 한다").toBeDefined();
      expect(meta.changed).toContain("index.html");
    } finally {
      await cleanup(admin, userId);
    }
  });

  test("[BL-018] 배포된 파일을 알려주므로 '내용을 붙여넣어 달라'고 되묻지 않는다", async ({
    page,
  }) => {
    const { admin, email, userId } = await setup("know");

    try {
      await page.goto("/login");
      await page.getByLabel("이메일").fill(email);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인" }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

      const { data: project } = await admin
        .from("projects")
        .insert({
          owner_id: userId,
          name: "기억 확인",
          slug: `p712k-${Date.now().toString(36)}`,
          status: "deployed",
          visibility: "private",
        })
        .select("id")
        .single();

      // 대화 기록은 **비어 있다** — 되돌리기 뒤나 기록이 잘린 대화와 같은 상태
      await admin.storage
        .from("artifacts")
        .upload(
          `${project!.id}/index.html`,
          "<!doctype html><html><head><title>소금빵 가게</title></head><body><h1>소금빵 가게</h1></body></html>",
          { contentType: "text/html; charset=utf-8", upsert: true },
        );

      const { data: conv } = await admin
        .from("conversations")
        .insert({
          owner_id: userId,
          title: "기억 확인",
          current_block: "maintenance",
          project_id: project!.id,
        })
        .select("id")
        .single();

      const res = await page.request.post("/api/chat", {
        data: { conversationId: conv!.id, message: "제목을 '단팥빵 가게'로 바꿔주세요." },
        timeout: 180_000,
      });
      expect(res.status()).toBe(200);
      const stream = await res.text();
      const answer = stream
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string; text?: string })
        .filter((e) => e.type === "text")
        .map((e) => e.text ?? "")
        .join("");

      // 예전에는 "현재 내용을 붙여넣어 주시겠어요?"라고 되물었다
      expect(answer, `모델 답변: ${answer.slice(0, 300)}`).not.toMatch(
        /붙여넣어|알려주시|전체 내용을.*주시/,
      );

      // 그리고 실제로 고쳐졌는가 — 기존 내용을 알아야만 할 수 있는 일이다
      const { data: saved } = await admin.storage
        .from("artifacts")
        .download(`${project!.id}/index.html`);
      const html = await saved!.text();
      expect(html, `저장된 내용: ${html.slice(0, 200)}`).toContain("단팥빵 가게");
      // 제목만 바꾸라 했으니 문서 뼈대는 남아 있어야 한다
      expect(html.toLowerCase()).toContain("<!doctype html>");
    } finally {
      await cleanup(admin, userId);
    }
  });
});
