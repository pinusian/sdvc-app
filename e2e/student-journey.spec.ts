import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";

/**
 * 통합 점검 — 수강생 한 명 몫을 처음부터 끝까지 (2026-09-13).
 *
 * 기존 e2e는 대부분 `/api/chat`을 가짜 응답으로 막아둔다(빠르고 공짜라서).
 * 6단계 전체를 **진짜 Claude로** 돌린 것은 [P5-5]에서 사람이 한 번 한 것뿐이고,
 * 그 뒤로 슬라이스 6~10과 프롬프트 변경이 쌓였다. 수강생이 겪을 것은
 * 가짜가 아니라 진짜이므로 여기서는 아무것도 막지 않는다.
 *
 * 설계:
 *  - **단계마다 부드러운 단정(`expect.soft`)** — 하나가 깨져도 끝까지 가서
 *    한 번의 실행으로 걸리는 것을 전부 모은다. 마지막에 점검표를 낸다.
 *  - 진짜 Claude를 부르므로 돈과 시간이 든다. 평소 회귀에는 섞이지 않게
 *    `SDVC_FULL_JOURNEY=1`일 때만 돈다.
 *  - 가입만은 관리자 API로 만든다. Supabase 무료 플랜의 확인메일 한도 때문이다
 *    ([P5-5]에서 실가입으로 짰다가 2회차에 막혔다). 대신 가입 트리거가
 *    프로필을 만들었는지는 확인한다.
 */

const RUN = process.env.SDVC_FULL_JOURNEY === "1";
const PASSWORD = "TestPass123!";
const TURN = 180_000; // 한 번의 Claude 답변
const BUILD = 360_000; // 구현 단계는 파일을 통째로 쓴다
const PNG = path.resolve(
  "C:/Users/USER/AppData/Local/Temp/claude/C--Users-USER-Claude------AI-Vibecoding-SDVC/23b932f7-17a3-4bfe-a062-4d1e557aa771/scratchpad/hero.png",
);

interface Check {
  step: string;
  ok: boolean;
  note: string;
}
const checks: Check[] = [];
function record(step: string, ok: boolean, note = "") {
  checks.push({ step, ok, note });
  console.log(`  ${ok ? "OK  " : "실패"} ${step}${note ? " — " + note : ""}`);
  expect.soft(ok, `${step}${note ? ": " + note : ""}`).toBe(true);
}

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

/** 답변이 끝날 때까지 — 보내기 버튼이 다시 살아나면 스트리밍이 끝난 것이다. */
async function waitTurn(page: Page, timeout = TURN) {
  await expect(page.getByRole("button", { name: "보내기" })).toBeEnabled({ timeout });
}

async function say(page: Page, text: string, timeout = TURN) {
  await page.getByLabel("메시지").fill(text);
  await page.getByRole("button", { name: "보내기" }).click();
  await waitTurn(page, timeout);
}

/** 게이트 버튼이 떴으면 그것으로, 아니면 늘 있는 "다음 단계로"로 넘어간다. */
async function advance(page: Page): Promise<"gate" | "manual"> {
  const gate = page.getByRole("button", { name: /예, 이대로 진행/ });
  if (await gate.isVisible().catch(() => false)) {
    await gate.click();
    await waitTurn(page);
    return "gate";
  }
  await page.getByRole("button", { name: /다음 단계로/ }).click();
  await waitTurn(page);
  return "manual";
}

const lastAssistantText = async (page: Page) =>
  (await page.locator("main").innerText()).slice(-600);

test.describe("통합 점검 — 수강생 한 명 몫", () => {
  test.skip(!RUN, "SDVC_FULL_JOURNEY=1 일 때만 돈다 (진짜 Claude를 부른다)");
  test.setTimeout(25 * 60 * 1000);

  test("가입 → 만들기 → 배포 → 고치기 → 사진 → 되돌리기 → 공개 → 요금제 → 신고 → 처리 → 감사", async ({
    page,
    browser,
    request,
  }) => {
    const admin = adminClient();
    const [local, domain] = process.env.ADMIN_EMAIL!.split("@");
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const student = `${local}+journey-s-${stamp}@${domain}`;
    const ops = `${local}+journey-o-${stamp}@${domain}`;
    let studentId = "";
    let opsId = "";
    let projectId = "";
    let slug = "";

    try {
      // ── 1. 가입 ───────────────────────────────────────────────
      const s = await admin.auth.admin.createUser({ email: student, password: PASSWORD, email_confirm: true });
      if (s.error || !s.data.user) throw new Error(s.error?.message);
      studentId = s.data.user.id;
      const o = await admin.auth.admin.createUser({ email: ops, password: PASSWORD, email_confirm: true });
      if (o.error || !o.data.user) throw new Error(o.error?.message);
      opsId = o.data.user.id;
      await admin.from("profiles").update({ role: "admin", admin_tier: "super" }).eq("id", opsId);

      const { data: prof } = await admin.from("profiles").select("role, grade, trial_ends_at").eq("id", studentId).maybeSingle();
      record("1. 가입 시 프로필·체험 등급 자동 생성", prof?.role === "developer" && prof?.grade === "trial", JSON.stringify(prof));

      // ── 2. 로그인 → 대시보드 ───────────────────────────────────
      await login(page, student);
      record("2. 로그인 → 대시보드", true);
      record("2a. 체험 등급·잔여일 표시", await page.getByText(/체험 \d+일 남음|체험 등급/).first().isVisible());
      record("2b. 프로젝트 0 / 1개 표시", await page.getByText(/프로젝트 0 \/ 1개/).isVisible());
      record("2c. 신고하기 입구 보임", await page.getByRole("link", { name: "신고하기" }).isVisible());
      record("2d. 서버 관리 입구는 안 보임 (일반 개발자)", (await page.getByRole("link", { name: "서버 관리" }).count()) === 0);

      // ── 3. 새 프로젝트 (이름 지정) ─────────────────────────────
      await page.getByRole("button", { name: /새 프로젝트/ }).click();
      await page.getByLabel("프로젝트 이름").fill("소금빵 가게");
      await page.getByRole("button", { name: "시작하기" }).click();
      await expect(page).toHaveURL(/\/conversations\//, { timeout: 30_000 });
      record("3. 새 프로젝트 → 대화 화면, 블록 1/6", await page.getByText(/블록 1 \/ 6/).isVisible());

      // ── 4. 블록 1~4 (진짜 Claude) ──────────────────────────────
      await say(page, "동네 소금빵 가게 홈페이지를 만들고 싶어요. 가게 소개, 메뉴 3개(소금빵·단팥빵·크루아상), 오시는 길, 이렇게 한 페이지면 돼요. 헌장은 추천대로 해주세요.");
      record("4a. 블록1 답변 도착", (await lastAssistantText(page)).length > 50);
      record("4a'. 게이트 표시가 화면에 새지 않음", (await page.getByText(/SDVC_GATE/).count()) === 0);
      let how = await advance(page);
      record("4b. 블록1 → 블록2", await page.getByText(/블록 2 \/ 6/).isVisible({ timeout: 10_000 }).catch(() => false), `이동 방식: ${how}`);

      await say(page, "전부 추천 답으로 해주세요.");
      how = await advance(page);
      record("4c. 블록2 → 블록3(계획)", await page.getByText(/블록 3 \/ 6/).isVisible({ timeout: 10_000 }).catch(() => false), `이동 방식: ${how}`);

      await say(page, "계획 좋아요.");
      how = await advance(page);
      record("4d. 블록3 → 블록4(작업분해) ★게이트", await page.getByText(/블록 4 \/ 6/).isVisible({ timeout: 10_000 }).catch(() => false), `이동 방식: ${how}`);

      await say(page, "작업 분해도 그대로 진행해주세요.");
      how = await advance(page);
      record("4e. 블록4 → 블록5(구현) ★게이트", await page.getByText(/블록 5 \/ 6/).isVisible({ timeout: 10_000 }).catch(() => false), `이동 방식: ${how}`);

      // ── 5. 구현 → 배포 ────────────────────────────────────────
      await say(page, "이제 홈페이지를 만들어주세요. 파일은 index.html과 style.css로요.", BUILD);
      const builtText = await page.getByText(/파일 \d+개/).first().isVisible({ timeout: 10_000 }).catch(() => false);
      const truncated = (await page.getByText(/잘렸|끊겼|이어서 받/).count()) > 0;
      record("5. 구현 → 파일 저장 안내", builtText, truncated ? "⚠ 답변이 잘렸다는 안내가 있음" : "");

      const { data: proj } = await admin.from("projects").select("id, slug, status, visibility").eq("owner_id", studentId).maybeSingle();
      projectId = proj?.id ?? "";
      slug = proj?.slug ?? "";
      record("5a. 프로젝트 행 생성 (deployed)", proj?.status === "deployed", JSON.stringify(proj));

      const { data: files } = await admin.storage.from("artifacts").list(projectId);
      const names = (files ?? []).filter((f) => f.id).map((f) => f.name);
      record("5b. 저장소에 index.html 존재", names.includes("index.html"), names.join(", "));

      const { data: v1 } = await admin.storage.from("versions").list(projectId);
      record("5c. 첫 버전 사본 생성", (v1 ?? []).some((v) => /^\d{4}$/.test(v.name)));

      record("5d. 비공개 기본값 → 익명 404", (await request.get(`/site/${slug}`)).status() === 404, `visibility=${proj?.visibility}`);
      const ownerView = await page.request.get(`/site/${slug}`);
      record("5e. 주인은 비공개여도 열람 가능", ownerView.status() === 200, `status ${ownerView.status()}`);

      // ── 6. 이어서 수정 (BL-001 · BL-018 · P7-12) ────────────────
      await page.goto("/dashboard");
      record("6. 대시보드에 프로젝트 1 / 1개", await page.getByText(/프로젝트 1 \/ 1개/).isVisible());
      await page.getByRole("link", { name: "이어서 수정" }).click();
      record("6a. 이어서 수정 → 블록 6/6 유지보수, 입력 가능", (await page.getByText(/블록 6 \/ 6/).isVisible()) && (await page.getByLabel("메시지").isEnabled()));
      record("6a'. '대화가 끝났습니다' 없음 (BL-001)", (await page.getByText("대화가 끝났습니다").count()) === 0);

      await say(page, "가게 이름을 '단팥빵 가게'로 바꿔주세요. 다른 건 그대로 두세요.", BUILD);
      const asked = /붙여넣|알려주시겠|전체 내용을 주/.test(await lastAssistantText(page));
      record("6b. 되묻지 않고 바로 고침 (BL-018)", !asked);
      const noFile = (await page.getByText(/저장된 파일이 없습니다/).count()) > 0;
      record("6c. '저장된 파일 없음' 경고 없음 (P7-12)", !noFile);
      const { data: afterEdit } = await admin.storage.from("artifacts").download(`${projectId}/index.html`);
      const htmlAfter = (await afterEdit?.text()) ?? "";
      record("6d. index.html에 '단팥빵 가게' 반영", htmlAfter.includes("단팥빵 가게"));
      record("6e. 뼈대 유지 (통째로 다시 만들지 않음)", /<!doctype html>/i.test(htmlAfter) && htmlAfter.includes("style.css"));

      // ── 7. 사진 첨부해서 넣기 (BL-004 · BL-005) ─────────────────
      await page.getByLabel("파일 붙이기").setInputFiles(PNG);
      await say(page, "방금 붙인 사진을 가게 대표 사진으로 첫 화면 맨 위에 넣어주세요.", BUILD);
      const { data: files2 } = await admin.storage.from("artifacts").list(projectId);
      const imgDirs = (files2 ?? []).filter((f) => !f.id).map((f) => f.name);
      let imgPaths: string[] = (files2 ?? []).filter((f) => f.id && /\.(png|jpe?g|gif|webp)$/i.test(f.name)).map((f) => f.name);
      for (const d of imgDirs) {
        const { data: inner } = await admin.storage.from("artifacts").list(`${projectId}/${d}`);
        imgPaths = imgPaths.concat((inner ?? []).filter((f) => f.id && /\.(png|jpe?g|gif|webp)$/i.test(f.name)).map((f) => `${d}/${f.name}`));
      }
      record("7a. 사진이 프로젝트 폴더에 저장됨", imgPaths.length > 0, imgPaths.join(", ") || "(없음)");
      const { data: afterImg } = await admin.storage.from("artifacts").download(`${projectId}/index.html`);
      const htmlImg = (await afterImg?.text()) ?? "";
      const referenced = imgPaths.some((p) => htmlImg.includes(p));
      const warned = (await page.getByText(/쓰는 곳이 없어 화면에 보이지 않습니다/).count()) > 0;
      record("7b. HTML이 그 사진을 씀 (안 쓰면 BL-005b 경고라도)", referenced || warned, referenced ? "참조함" : warned ? "경고 표시됨" : "참조도 경고도 없음");
      if (imgPaths[0]) {
        const served = await page.request.get(`/site/${slug}/${imgPaths[0]}`);
        record("7c. 사진이 실제로 서빙됨", served.status() === 200 && (served.headers()["content-type"] ?? "").startsWith("image/"), `status ${served.status()} ${served.headers()["content-type"]}`);
      }

      // ── 8. 되돌리기 (P7-7) ─────────────────────────────────────
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "되돌리기" }).click();
      const rows = page.locator("li").filter({ has: page.getByRole("button", { name: /시점으로 되돌리기/ }) });
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      const versionCount = await rows.count();
      record("8. 되돌리기 목록에 버전 3개 (구현·제목·사진)", versionCount >= 3, `${versionCount}개`);
      // 제목을 바꾸기 전 = 처음 만든 시점
      const target = rows.filter({ hasText: /만들어주세요|index\.html/ }).first();
      await target.getByRole("button", { name: /시점으로 되돌리기/ }).click();
      await page.getByRole("button", { name: "네, 되돌립니다" }).click();
      await expect(page.getByText(/되돌렸|복구/)).toBeVisible({ timeout: 30_000 }).catch(() => {});
      const { data: afterRb } = await admin.storage.from("artifacts").download(`${projectId}/index.html`);
      const htmlRb = (await afterRb?.text()) ?? "";
      record("8a. 되돌린 뒤 '단팥빵 가게'가 사라짐 (처음 상태)", !htmlRb.includes("단팥빵 가게") && htmlRb.length > 0);

      // 되돌린 뒤 또 고치기 — BL-018의 핵심 상황(대화 기록과 실제 파일이 어긋남)
      await page.getByRole("link", { name: "이어서 수정" }).click();
      await say(page, "첫 화면 제목 옆에 '(임시 휴업 없음)'이라는 짧은 안내를 덧붙여주세요. 다른 건 그대로요.", BUILD);
      const { data: afterRb2 } = await admin.storage.from("artifacts").download(`${projectId}/index.html`);
      const htmlRb2 = (await afterRb2?.text()) ?? "";
      record("8b. 되돌린 뒤 고쳐도 '단팥빵'이 되살아나지 않음 (실제 파일 기준으로 고침)", htmlRb2.includes("임시 휴업 없음") && !htmlRb2.includes("단팥빵 가게"), htmlRb2.includes("단팥빵 가게") ? "⚠ 대화 기록의 옛 내용이 되살아남" : "");

      // ── 9. 공개범위 → 링크 공개 ────────────────────────────────
      await page.goto("/dashboard");
      const saved = page.waitForResponse((r) => r.url().includes("/visibility") && r.request().method() === "PATCH");
      await page.getByLabel("공개범위").selectOption("link");
      await saved;
      const anon = await request.get(`/site/${slug}`);
      record("9. 링크 공개 → 익명 200, HTML", anon.status() === 200 && (anon.headers()["content-type"] ?? "").includes("text/html"));
      record("9a. 주소 복사 버튼", await page.getByRole("button", { name: /주소 복사/ }).isVisible());

      // ── 10. 요금제 화면 ───────────────────────────────────────
      await page.getByRole("link", { name: "요금제 보기" }).click();
      record("10. 요금제 화면: 체험 '이용 중' + 기본/프로 시작 버튼", (await page.getByText("이용 중").isVisible()) && (await page.getByRole("button", { name: "기본으로 시작" }).isVisible()));

      // ── 11. 신고 → 운영자 처리 → 결과 확인 ────────────────────
      await page.goto("/report");
      await page.getByLabel("무슨 일이 있었나요").fill("되돌리기를 눌렀는데 화면이 바로 안 바뀌고 새로고침해야 보였어요.");
      await page.getByRole("button", { name: "신고 보내기" }).click();
      record("11. 신고 접수", await page.getByText("신고를 접수했습니다").isVisible({ timeout: 20_000 }).catch(() => false));

      const ctx = await browser.newContext();
      const opsPage = await ctx.newPage();
      await login(opsPage, ops);
      record("11a. 운영자 대시보드에 '서버 관리' 입구", await opsPage.getByRole("link", { name: "서버 관리" }).isVisible());
      await opsPage.goto("/admin");
      record("11b. 운영 콘솔: 수강생이 목록에 보임", await opsPage.getByText(student).first().isVisible());
      await opsPage.goto("/admin/reports");
      record("11c. 접수함에 신고 보임", await opsPage.getByText("되돌리기를 눌렀는데").isVisible());
      await opsPage.getByRole("button", { name: /처리$/ }).first().click();
      await opsPage.getByLabel("처리 상태").selectOption("resolved");
      await opsPage.getByLabel("답변").fill("확인했습니다. 다음 판에서 화면이 바로 바뀌도록 고치겠습니다.");
      await opsPage.getByRole("button", { name: "저장" }).click();
      record("11d. 운영자 처리 저장", await opsPage.getByText("처리했습니다").isVisible({ timeout: 20_000 }).catch(() => false));

      await opsPage.goto("/admin/audit");
      record("12. 감사 기록에 '신고 처리' 행 (운영자 이메일로)", await opsPage.getByRole("row", { name: /신고 처리/ }).filter({ hasText: ops }).first().isVisible());
      await ctx.close();

      await page.goto("/report");
      record("11e. 수강생이 처리 결과·답변을 본다", (await page.getByText("처리 완료").isVisible()) && (await page.getByText("다음 판에서 화면이 바로 바뀌도록").isVisible()));

      // ── 13. 알려진 구멍 확인 (BL-014) ─────────────────────────
      const { data: cnt } = await admin.from("projects").select("id").eq("owner_id", studentId);
      record("13. 프로젝트 수 = 1 (체험 한도 1개 안)", (cnt ?? []).length === 1, `BL-014: 2개째를 막는 코드가 없음 — 이번엔 시도하지 않았음`);
    } finally {
      console.log("\n===== 점검표 =====");
      for (const c of checks) console.log(`  ${c.ok ? "OK  " : "실패"} ${c.step}${c.note ? " — " + c.note : ""}`);
      console.log(`  합계: ${checks.filter((c) => c.ok).length} / ${checks.length}`);

      for (const uid of [studentId, opsId]) {
        if (!uid) continue;
        const { data: ps } = await admin.from("projects").select("id").eq("owner_id", uid);
        for (const p of ps ?? []) {
          for (const bucket of ["artifacts", "versions", "attachments"]) {
            const { data: top } = await admin.storage.from(bucket).list(p.id);
            for (const e of top ?? []) {
              if (e.id) await admin.storage.from(bucket).remove([`${p.id}/${e.name}`]);
              else {
                const { data: inner } = await admin.storage.from(bucket).list(`${p.id}/${e.name}`);
                if (inner?.length) await admin.storage.from(bucket).remove(inner.map((f) => `${p.id}/${e.name}/${f.name}`));
              }
            }
          }
        }
        await admin.from("reports").delete().eq("reporter_id", uid);
        await admin.auth.admin.deleteUser(uid);
      }
    }
  });
});
