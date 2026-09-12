import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * [BL-016] 프로필 자가 복구 (FR-021).
 *
 * 실제로 겪은 일: 가입자 2명에게 `profiles` 행이 없어 대화가 402로 막혔고,
 * **운영 콘솔 목록에도 보이지 않아** 운영자가 알 방법이 없었다.
 *
 * 그러니 여기서 볼 것은 "함수를 불렀는가"가 아니라
 * **프로필이 사라진 사람이 로그인만으로 되살아나는가**다.
 * 진짜 DB에서 프로필을 지우고 지나가 본다.
 */

const PASSWORD = "TestPass123!";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test("[BL-016] 프로필이 없어진 사람이 로그인하면 스스로 되살아난다", async ({ page }) => {
  const admin = adminClient();
  const [local, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${local}+heal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");
  const userId = data.user.id;

  try {
    // 겪었던 상태를 그대로 만든다 — auth에는 있고 profiles에는 없다
    await admin.from("profiles").delete().eq("id", userId);
    const { data: gone } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    expect(gone, "먼저 프로필 없는 상태를 만들어야 한다").toBeNull();

    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    // 되살아났는가
    const { data: healed } = await admin
      .from("profiles")
      .select("id, email, role, grade, trial_ends_at")
      .eq("id", userId)
      .maybeSingle();

    expect(healed, "로그인만으로 프로필이 생겨야 한다").not.toBeNull();
    expect(healed!.email).toBe(email);
    expect(healed!.role).toBe("developer");
    expect(healed!.grade).toBe("trial");
    // 체험 기간은 DB 기본값(7일)을 그대로 받는다 — 계산이 두 군데면 어긋난다
    expect(new Date(healed!.trial_ends_at).getTime()).toBeGreaterThan(Date.now());

    // 그리고 실제로 쓸 수 있는가 — 402로 막히던 바로 그 자리
    const { data: conv } = await admin
      .from("conversations")
      .insert({ owner_id: userId, title: "복구 확인", current_block: "maintenance" })
      .select("id")
      .single();

    const res = await page.request.post("/api/chat", {
      data: { conversationId: conv!.id, message: "짧게 한 문장만 인사해주세요." },
      timeout: 180_000,
    });
    expect(res.status(), "402 '계정 정보를 확인할 수 없습니다'가 더는 나오지 않아야 한다").toBe(
      200,
    );

    // 운영 콘솔 목록에도 보이는가 (목록은 profiles에서 온다)
    const { data: listed } = await admin.from("profiles").select("email").eq("email", email);
    expect(listed).toHaveLength(1);
  } finally {
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
});

test("[BL-016] 멀쩡한 프로필은 건드리지 않는다 — 등급·체험을 덮어쓰면 안 된다", async ({
  page,
}) => {
  const admin = adminClient();
  const [local, domain] = process.env.ADMIN_EMAIL!.split("@");
  const email = `${local}+keep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${domain}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "테스트 유저 생성 실패");
  const userId = data.user.id;

  try {
    // 운영자가 손봐둔 상태를 흉내 낸다
    const until = "2027-06-30T14:59:59.000Z";
    await admin
      .from("profiles")
      .update({ granted_grade: "pro", granted_until: until, monthly_token_limit: 123456 })
      .eq("id", userId);

    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    const { data: after } = await admin
      .from("profiles")
      .select("granted_grade, granted_until, monthly_token_limit")
      .eq("id", userId)
      .single();

    expect(after!.granted_grade).toBe("pro");
    expect(new Date(after!.granted_until).toISOString()).toBe(until);
    expect(after!.monthly_token_limit).toBe(123456);
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});
