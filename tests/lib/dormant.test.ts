// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * [P8-8] 잠든 코드 기록 (제외 기록).
 *
 * **만들어만 두고 아무도 부르지 않는 함수**가 이번 한 세션에 세 번 나왔다:
 *   BL-008 `ensureAdminRole` — ADMIN_EMAIL로 가입해도 관리자가 안 됐다
 *   BL-009 관리자 입구       — 승격돼도 들어갈 길이 없었다
 *   BL-013 `setProjectBlocked` — 비상 차단이 동작하지 않았다
 *
 * 셋 다 **단위 테스트는 통과했다.** 단위 테스트는 함수를 직접 부르므로,
 * 아무도 그 함수를 부르지 않는다는 사실은 영영 드러나지 않는다.
 *
 * 그래서 기록을 글이 아니라 **검사**로 둔다. 새로 잠든 함수가 생기면 여기서
 * 막히고, 잠을 깬 함수는 목록에서 빠지라고 알려준다 — 기록이 저절로
 * 사실로 유지된다.
 *
 * 범위는 `src/lib`의 `export function`이다. 화면·라우트는 Next가 부르므로
 * 여기서 세지 않는다.
 */

const ROOT = process.cwd();

/**
 * 잠들어 있음을 **알고 있는** 것들. 값은 왜 그대로 두는지다.
 * 이유를 못 적겠으면 그건 지울 코드라는 뜻이다.
 */
const KNOWN_DORMANT: Record<string, string> = {
  createPersistentRun:
    "[T033] 지속 작업 생성 도메인 서비스. T035에서 수강생 작업 API·화면에 배선한 뒤 이 휴면 예외를 제거한다",
  cancelPersistentRun:
    "[T033] 지속 작업 취소 도메인 서비스. T035에서 취소 API·화면에 배선한 뒤 이 휴면 예외를 제거한다",
  resumePersistentRun:
    "[T033] 재접속 작업 복원 도메인 서비스. T035에서 진행 화면 재접속 경로에 배선한 뒤 이 휴면 예외를 제거한다",
  provisionTrialApplication:
    "[T011] Supabase/Vercel 앱 리소스 기술검증 제어기. T038에서 실제 프로비저닝 작업 경로에 " +
    "배선한 뒤 이 휴면 예외를 제거한다",
  runTddVerification:
    "[T009] Sandbox 실행 제어 기술검증 어댑터. T034에서 Workflow 작업 실행 경로에 " +
    "배선한 뒤 이 휴면 예외를 제거한다",
  hasVerifiedMfa:
    "[P8-1] MFA 건너뛰기로 결정(2026-09-13). 관리자 1인 체제에서 2단계 인증을 켜면 " +
    "휴대폰을 잃는 순간 운영 콘솔에 아무도 못 들어간다. 복구 수단과 함께 다시 볼 것",
  isBlockId:
    "블록 id 형식 검사. 지금은 DB CHECK와 타입이 막고 있어 부를 자리가 없다. " +
    "바깥에서 블록 id를 받는 입구가 생기면 그때 쓴다",
  stripGateMarker:
    "게이트 표시 제거. 스트리밍 경로는 splitPendingMarker로 조각 단위로 처리하므로 " +
    "이 함수가 필요 없다. 스트리밍이 아닌 경로가 생기면 쓴다",
  toSeoulDateInput:
    "[P8-7c] 저장된 순간을 날짜 입력칸으로 되돌린다. 아직 '고치기' 화면이 없어 쓰는 곳이 없다",
};

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** `src` 전체에서 한 번도 불리지 않는 `src/lib`의 export 함수 이름들 */
function findDormant(): string[] {
  const srcFiles = walk(path.join(ROOT, "src"));
  const bodies = srcFiles.map((f) => fs.readFileSync(f, "utf-8"));
  const libFiles = srcFiles.filter((f) => f.includes(`${path.sep}lib${path.sep}`));

  const dormant: string[] = [];

  for (const file of libFiles) {
    const source = fs.readFileSync(file, "utf-8");
    const declaration = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;

    let match: RegExpExecArray | null;
    while ((match = declaration.exec(source))) {
      const name = match[1];
      const word = new RegExp(`\\b${name}\\b`, "g");

      // 선언 자체는 빼고 센다. 자기 파일 안에서 쓰이면 잠든 것이 아니다.
      const uses = bodies.reduce((sum, body) => sum + (body.match(word) || []).length, 0);
      const declarations = bodies.reduce(
        (sum, body) =>
          sum + (body.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`, "g")) || []).length,
        0,
      );

      if (uses - declarations === 0) dormant.push(name);
    }
  }

  return [...new Set(dormant)].sort();
}

describe("[P8-8] 잠든 코드 기록", () => {
  const dormant = findDormant();

  it("새로 잠든 함수가 생기면 여기서 막힌다 — 만든 것과 도는 것은 다르다", () => {
    const unlisted = dormant.filter((name) => !(name in KNOWN_DORMANT));

    expect(
      unlisted,
      unlisted.length
        ? `\n아무도 부르지 않는 함수가 새로 생겼습니다: ${unlisted.join(", ")}\n` +
            `배선하거나, 지우거나, KNOWN_DORMANT에 **왜 두는지**를 적으세요.\n` +
            `이유를 못 적겠으면 그건 지울 코드입니다.\n`
        : undefined,
    ).toEqual([]);
  });

  it("잠을 깬 함수는 목록에서 빠진다 — 기록이 사실과 어긋나지 않게", () => {
    const stale = Object.keys(KNOWN_DORMANT).filter((name) => !dormant.includes(name));

    expect(
      stale,
      stale.length
        ? `\n이제 쓰이고 있습니다: ${stale.join(", ")}\nKNOWN_DORMANT에서 지워주세요.\n`
        : undefined,
    ).toEqual([]);
  });

  it("두는 이유를 반드시 적는다", () => {
    for (const [name, reason] of Object.entries(KNOWN_DORMANT)) {
      expect(reason.trim().length, `${name}의 이유가 비어 있습니다`).toBeGreaterThan(20);
    }
  });
});
