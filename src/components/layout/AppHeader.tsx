import type { ReactNode } from "react";
import Link from "next/link";

/**
 * [P8-11] 개발자 화면 머리 (FR-040, BL-009).
 *
 * 관리자로 승격시켜 놓고 들어갈 길을 만들지 않았던 것이 BL-009였다 —
 * 주소를 외우는 사람만 쓸 수 있는 기능은 없는 기능과 같다.
 *
 * **관리자가 아니면 링크를 그리지 않는다.** 눌러봐야 404가 뜰 링크를
 * 보여주는 것은 "여기 관리자 화면이 있다"고 알려주는 것과 같다.
 */

interface Props {
  isAdmin?: boolean;
  /** 로그아웃 등 오른쪽 끝에 놓을 것 */
  children?: ReactNode;
}

export function AppHeader({ isAdmin = false, children }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-7 py-4">
      <div className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        SDVC
      </div>

      <div className="flex items-center gap-4">
        {/* [P8-5] 문제를 알릴 통로는 누구에게나 보인다 (FR-013) */}
        <Link
          href="/report"
          className="text-xs text-ink-muted underline-offset-4 hover:text-accent-ink hover:underline"
        >
          신고하기
        </Link>
        {isAdmin && (
          <Link
            href="/admin"
            className="text-xs font-medium text-ink-muted underline-offset-4 hover:text-accent-ink hover:underline"
          >
            서버 관리
          </Link>
        )}
        {children}
      </div>
    </header>
  );
}
