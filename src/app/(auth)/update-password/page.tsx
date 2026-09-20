"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { validatePasswordUpdate, updateDeveloperPassword } from "@/lib/auth/reset";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

/**
 * [BL-030] 새 비밀번호 정하기 — 비밀번호 재설정 메일의 링크를 눌러 들어온다.
 *
 * 그 링크는 Supabase가 임시 세션을 붙여 이 페이지로 돌려보내는 방식이라
 * (가입 확인 메일이 `/verify-email`을 그렇게 여는 것과 같은 구조),
 * 서버가 아니라 **브라우저**에서 지금 세션이 있는지부터 확인해야 한다.
 */
export default function UpdatePasswordPage() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = validatePasswordUpdate(password, confirm);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setPending(true);
    const supabase = createClient();
    const result = await updateDeveloperPassword(supabase, password);
    if (!result.success) {
      setError(result.error);
      setPending(false);
      return;
    }

    // 링크로 생긴 임시 세션은 여기서 끝낸다 — 새 비밀번호로 다시 로그인하게 한다.
    await supabase.auth.signOut();
    setPending(false);
    setDone(true);
  }

  if (done) {
    return (
      <Card className="text-center">
        <h1 className="mb-2">비밀번호를 바꿨어요</h1>
        <p className="mb-6 text-sm text-ink-muted">새 비밀번호로 다시 로그인해주세요.</p>
        <Link href="/login">
          <Button variant="accent" className="w-full">
            로그인하러 가기
          </Button>
        </Link>
      </Card>
    );
  }

  if (ready === null) {
    return (
      <Card className="text-center">
        <p className="text-sm text-ink-muted">확인하는 중…</p>
      </Card>
    );
  }

  if (ready === false) {
    return (
      <Card className="text-center">
        <h1 className="mb-2">링크가 만료되었거나 올바르지 않아요</h1>
        <p className="mb-6 text-sm text-ink-muted">
          비밀번호 찾기를 다시 요청해서 새 링크를 받아주세요.
        </p>
        <Link href="/forgot-password">
          <Button variant="accent" className="w-full">
            다시 요청하기
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-6">새 비밀번호 정하기</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="새 비밀번호"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="새 비밀번호 확인"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {error && (
          <p className="rounded-sm bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>
        )}

        <Button type="submit" variant="accent" disabled={pending} className="mt-2 w-full">
          {pending ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </Button>
      </form>
    </Card>
  );
}
