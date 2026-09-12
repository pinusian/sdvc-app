"use client";

import { useActionState } from "react";
import { adminLoginAction, adminLogoutAction, type AuthActionState } from "@/app/(auth)/actions";
import { AdminSignIn } from "@/components/admin/AdminSignIn";

/**
 * [P8-12] 서버 액션을 화면에 붙이는 얇은 껍데기.
 *
 * 화면(`AdminSignIn`)은 액션을 모르고 시험 가능한 상태로 둔다 —
 * 서버 액션을 직접 부르는 컴포넌트는 단위 시험에서 서버 코드를 끌고 온다.
 */

const initialState: AuthActionState = { error: null };

export function AdminLoginPanel({ signedInAs }: { signedInAs: string | null }) {
  const [state, action, pending] = useActionState(adminLoginAction, initialState);

  return (
    <AdminSignIn
      signedInAs={signedInAs}
      action={action}
      logoutAction={adminLogoutAction}
      pending={pending}
      error={state.error}
    />
  );
}
