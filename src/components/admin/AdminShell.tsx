import type { ReactNode } from "react";
import Link from "next/link";
import type { AdminTier } from "@/lib/admin/access";

/**
 * [P8-11] 관리자 화면 껍데기 (FR-039).
 *
 * 개발자 화면과 **한눈에 달라야 한다**. 같은 흰 머리띠를 쓰면 관리자는
 * 남의 계정을 손보는 중인지 자기 프로젝트를 보는 중인지 헷갈린다 —
 * 남의 등급을 바꾸는 화면에서 생길 착각치고는 값이 비싸다.
 *
 * 그래서 상단 띠를 **반전**시킨다(`bg-ink`). 밝기 설정이 무엇이든 본문과
 * 반대로 칠해지므로 어느 쪽에서도 "다른 곳"으로 읽힌다.
 */

const TIER_LABEL: Record<AdminTier, string> = {
  super: "최고관리자",
  operator: "운영자",
  support: "지원",
};

interface Props {
  email: string;
  tier: AdminTier | null;
  /** 로그아웃 등 오른쪽 끝에 놓을 것 (서버 액션 폼을 그대로 받는다) */
  logout?: ReactNode;
  children: ReactNode;
}

export function AdminShell({ email, tier, logout, children }: Props) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-ink px-7 py-4 text-surface">
        <div className="flex items-center gap-3">
          {/* 개발자 화면은 동그라미, 여기는 네모 — 아이콘만 봐도 갈린다 */}
          <span className="h-2.5 w-2.5 rounded-[2px] bg-accent" />
          <span className="font-serif text-lg font-semibold">운영 콘솔</span>
          {tier && (
            <span className="rounded-pill border border-white/25 px-2.5 py-0.5 text-xs font-medium">
              {TIER_LABEL[tier]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs opacity-70">{email}</span>
          <Link href="/dashboard" className="text-xs underline-offset-4 hover:underline">
            개발자 화면
          </Link>
          {logout}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[960px] flex-1 px-7 py-8">{children}</main>
    </div>
  );
}
