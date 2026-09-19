"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type AuthActionState } from "../actions";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

const initialState: AuthActionState = { error: null };

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <Card>
      <h1 className="mb-2">수강생 로그인</h1>
      <p className="mb-6 text-sm text-ink-muted">
        내 프로젝트와 진행 중인 SDVC 작업을 이어가세요.
      </p>

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

        <Button type="submit" variant="accent" disabled={pending} className="mt-2 w-full">
          {pending ? "로그인 중…" : "로그인"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        아직 계정이 없으신가요?{" "}
        <Link href="/signup" className="font-medium text-accent-ink hover:underline">
          가입하기
        </Link>
      </p>
    </Card>
  );
}
