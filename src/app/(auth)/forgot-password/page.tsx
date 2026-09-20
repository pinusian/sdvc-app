"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { requestPasswordResetAction, type AuthActionState } from "../actions";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

const initialState: AuthActionState = { error: null };

/**
 * [BL-030] 비밀번호 찾기 요청 화면 — 개발자·시스템관리자 공용.
 * 성공하면 `?sent=1`로 돌아와 같은 페이지가 "메일함을 확인해주세요"로
 * 바뀐다([P2-5] 가입 확인(`/verify-email`)과 같은 방식).
 *
 * `useSearchParams`를 쓰는 부분은 Suspense로 감싼다 — 안 감싸면 정적
 * 빌드(prerender)가 실패한다(Next.js 요구사항).
 */
export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}

function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialState);
  const sent = useSearchParams().get("sent") === "1";

  if (sent) {
    return (
      <Card className="text-center">
        <h1 className="mb-2">메일함을 확인해주세요</h1>
        <p className="mb-6 text-sm text-ink-muted">
          입력하신 이메일로 비밀번호 재설정 링크를 보내드렸어요. 그 계정이 없더라도
          같은 화면을 보여드립니다 — 계정 존재 여부는 알려드리지 않아요. (메일이 안
          보이면 스팸함도 확인해주세요)
        </p>
        <Link href="/login">
          <Button variant="secondary" className="w-full">
            로그인 화면으로
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-2">비밀번호 찾기</h1>
      <p className="mb-6 text-sm text-ink-muted">
        가입하신 이메일 주소를 입력하시면 비밀번호를 재설정할 수 있는 링크를 보내드려요.
      </p>

      <form action={action} className="flex flex-col gap-4">
        <Field label="이메일" name="email" type="email" required autoComplete="email" />

        {state.error && (
          <p className="rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {state.error}
          </p>
        )}

        <Button type="submit" variant="accent" disabled={pending} className="mt-2 w-full">
          {pending ? "보내는 중…" : "재설정 링크 보내기"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-accent-ink hover:underline">
          로그인 화면으로 돌아가기
        </Link>
      </p>
    </Card>
  );
}
