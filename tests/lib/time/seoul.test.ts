import { describe, expect, it } from "vitest";
import {
  endOfDaySeoul,
  formatSeoulDate,
  formatSeoulDateTime,
  toSeoulDateInput,
} from "@/lib/time/seoul";

/**
 * [P8-7c] 이 서비스는 한국 시각으로 생각한다 (BL-012).
 *
 * 서버(Vercel)는 UTC로 돈다. 그걸 그대로 두면 운영자가 고른 날짜와
 * 실제로 저장되는 순간이 **9시간 어긋난다** — 실제로 어긋나 있었다:
 * `2026-12-31`을 고르면 만료가 `2027-01-01 08:59:59`였고
 * 관리 화면에도 `2027. 1. 1.`로 떴다.
 *
 * 시간 계산이 여러 곳에 흩어지면 한 곳만 고쳐지는 날이 온다 —
 * `loadAdminActor`를 하나로 모은 것([P8-11d])과 같은 이유다.
 */

describe("[P8-7c] endOfDaySeoul", () => {
  it("고른 날의 한국 시각 끝(23:59:59)을 가리킨다", () => {
    // 2026-12-31 23:59:59 KST = 2026-12-31 14:59:59 UTC
    expect(endOfDaySeoul("2026-12-31")).toBe("2026-12-31T14:59:59.000Z");
  });

  it("UTC로 해석하지 않는다 — 이것이 BL-012였다", () => {
    expect(endOfDaySeoul("2026-12-31")).not.toBe("2026-12-31T23:59:59.000Z");
  });

  it("되돌려 보면 고른 날 그대로다", () => {
    for (const day of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      const stored = endOfDaySeoul(day);
      expect(stored).not.toBeNull();
      expect(formatSeoulDate(stored!)).toBe(day);
    }
  });

  it("빈 값이면 null — 무기한 부여를 날짜로 둔갑시키지 않는다", () => {
    expect(endOfDaySeoul("")).toBeNull();
    expect(endOfDaySeoul(null)).toBeNull();
  });

  it("날짜가 아니면 null", () => {
    expect(endOfDaySeoul("아무거나")).toBeNull();
    expect(endOfDaySeoul("2026-13-45")).toBeNull();
  });
});

describe("[P8-7c] formatSeoulDate / formatSeoulDateTime", () => {
  it("UTC 늦은 시각은 한국에서 다음 날이다", () => {
    expect(formatSeoulDate("2026-09-12T16:00:00Z")).toBe("2026-09-13");
    expect(formatSeoulDateTime("2026-09-12T16:00:00Z")).toBe("2026-09-13 01:00");
  });

  it("자정 직전도 정확히", () => {
    expect(formatSeoulDateTime("2026-09-12T14:59:59Z")).toBe("2026-09-12 23:59");
  });

  it("읽을 수 없는 값은 원문 그대로 — 감사 기록에서 값이 사라지면 안 된다", () => {
    expect(formatSeoulDateTime("깨진값")).toBe("깨진값");
    expect(formatSeoulDate("깨진값")).toBe("깨진값");
  });
});

describe("[P8-7c] toSeoulDateInput", () => {
  it("저장된 순간을 날짜 입력칸(yyyy-mm-dd)으로 되돌린다", () => {
    expect(toSeoulDateInput("2026-12-31T14:59:59.000Z")).toBe("2026-12-31");
  });

  it("없으면 빈 칸", () => {
    expect(toSeoulDateInput(null)).toBe("");
  });
});
