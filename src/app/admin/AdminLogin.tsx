"use client";

import { useActionState } from "react";
import { adminLoginAction, type AuthActionState } from "@/app/(auth)/actions";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

/**
 * [P8-11c] `/admin` 자리에서 그대로 받는 관리자 로그인 (FR-038).
 *
 * `/login`으로 튕기지 않는다 — 주소가 바뀌면 관리자는 자기가 어디로
 * 들어왔는지를 잃는다. 가입 링크도 두지 않는다: 관리자는 가입해서 되는 것이
 * 아니라 `ADMIN_EMAIL`로 승격되는 것이다([BL-008]).
 */

const initialState: AuthActionState = { error: null };

export function AdminLogin() {
  const [state, action, pending] = useActionState(adminLoginAction, initialState);

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

          <form action={action} className="flex flex-col gap-4">
            <Field label="이메일" name="email" type="email" required autoComplete="email" />
            <Field
              label="비밀번호"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />

            {state.error && (
              <p className="rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                {state.error}
              </p>
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
