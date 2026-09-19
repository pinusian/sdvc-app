import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * 기존 Route Handler 단위 테스트는 각 파일이 인증 사용자만 목으로 제공한다.
 * T015부터 공통 가드 자체는 전용 테스트에서 실제 구현을 검증하고, 기존 라우트
 * 테스트는 이 얇은 목으로 활성 수강생을 가정해 본래 관심사만 계속 검사한다.
 * 공통 가드 통합 테스트는 `vi.unmock`으로 실제 모듈을 사용한다.
 */
vi.mock("@/lib/auth/learner-route-guard", () => ({
  async requireLearnerAccess() {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return user
      ? { ok: true as const, user }
      : {
          ok: false as const,
          response: Response.json(
            { error: "로그인이 필요합니다.", code: "unauthenticated" },
            { status: 401 },
          ),
        };
  },
}));
