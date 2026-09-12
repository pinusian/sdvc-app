"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

/**
 * [P8-12] 관리자 로그인 화면 (FR-038).
 *
 * 이 화면이 맡는 상황은 둘이다: **아직 로그인하지 않았다**와
 * **자격 없는 계정으로 들어왔다**. 뒤엣것이 맨 404였던 것이 문제였다 —
 * 계정을 여러 개 쓰는 운영자에게는 흔한 일인데, 화면은 아무 말도 하지
 * 않으니 배포가 깨진 것인지 계정이 틀린 것인지 알 길이 없었다.
 *
 * 로그아웃 자리에 평범한 `logoutAction`을 쓰지 않는다 — 그것은 `/login`으로
 * 보내서 방금 애써 찾아온 관리자 주소를 다시 잃게 만든다.
 */

interface Props {
  /** 자격 없는 계정으로 로그인한 상태면 그 주소, 아니면 null */
  signedInAs: string | null;
  action: (formData: FormData) => void;
  logoutAction: () => void;
  pending: boolean;
  error?: string | null;
}

export function AdminSignIn({ signedInAs, action, logoutAction, pending, error }: Props) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-ink px-7 py-4 text-surface">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-accent" />
        <span className="font-serif text-lg font-semibold">운영 콘솔</span>
      </header>

      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-7 py-12">
        <Card>
          <h1 className="mb-1">서버 관리자 로그인</h1>
          <p className="mb-6 text-sm text-ink-muted">SDVC 운영에 쓰는 계정으로 들어오세요.</p>

          {signedInAs && (
            <div className="mb-6 rounded-sm border border-border bg-surface-muted px-3.5 py-3 text-sm">
              <p className="text-ink">
                지금 <strong>{signedInAs}</strong> 계정으로 로그인되어 있습니다.
              </p>
              <p className="mt-0.5 text-ink-muted">
                이 계정으로는 운영 콘솔에 들어올 수 없습니다.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <form action={logoutAction}>
                  <Button type="submit" variant="secondary" className="!px-3 !py-1.5 text-xs">
                    다른 계정으로 로그인
                  </Button>
                </form>
                <Link
                  href="/dashboard"
                  className="text-xs text-ink-muted underline-offset-4 hover:text-accent-ink hover:underline"
                >
                  개발자 화면으로
                </Link>
              </div>
            </div>
          )}

          <form action={action} className="flex flex-col gap-4">
            <Field label="이메일" name="email" type="email" required autoComplete="email" />
            <Field
              label="비밀번호"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />

            {error && (
              <p className="rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>
            )}

            <Button type="submit" variant="primary" disabled={pending} className="mt-2 w-full">
              {pending ? "확인 중…" : "로그인"}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
