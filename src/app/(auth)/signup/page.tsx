"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, type AuthActionState } from "../actions";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

const initialState: AuthActionState = { error: null };

export default function SignupPage() {
  const [state, action, pending] = useActionState(signupAction, initialState);

  return (
    <Card>
      <h1 className="mb-1.5">SDVC 시작하기</h1>
      <p className="mb-6 text-sm text-ink-muted">
        가입하면 7일 무료 체험으로 바로 프로젝트를 만들 수 있어요.
      </p>

      <form action={action} className="flex flex-col gap-4">
        <Field label="이메일" name="email" type="email" required autoComplete="email" />
        <Field
          label="비밀번호 (8자 이상)"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />

        {state.error && (
          <p className="rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {state.error}
          </p>
        )}

        <Button type="submit" variant="accent" disabled={pending} className="mt-2 w-full">
          {pending ? "가입 처리 중…" : "가입하기"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className="font-medium text-accent-ink hover:underline">
          로그인
        </Link>
      </p>

      {/* [P10-2a] 이메일을 받는 순간 개인정보보호법이 적용된다 (FR-037) */}
      <p className="mt-3 text-center text-xs text-ink-faint">
        가입하시면{" "}
        <Link href="/privacy" className="underline hover:text-accent-ink">
          개인정보 처리방침
        </Link>
        에 동의하는 것으로 봅니다.
      </p>
    </Card>
  );
}
