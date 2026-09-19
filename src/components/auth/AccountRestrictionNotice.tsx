import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export interface AccountRestrictionNoticeProps {
  kind: "suspended" | "inactive" | "unavailable";
  reason?: string | null;
}

const COPY = {
  suspended: {
    title: "계정 이용이 제한되었습니다",
    body: "현재 이 계정으로 프로젝트·AI 실행·결제 기능을 사용할 수 없습니다.",
  },
  inactive: {
    title: "비활성화된 계정입니다",
    body: "현재 이 계정의 서비스 이용이 중지되어 있습니다.",
  },
  unavailable: {
    title: "계정 상태를 확인할 수 없습니다",
    body: "잠시 뒤 다시 시도하거나 관리자에게 문의해주세요.",
  },
} as const;

export function AccountRestrictionNotice({ kind, reason }: AccountRestrictionNoticeProps) {
  const copy = COPY[kind];
  const visibleReason = kind === "suspended" ? reason?.trim() : null;

  return (
    <Card>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-danger">
        접근 제한
      </p>
      <h1 className="mb-3">{copy.title}</h1>
      <p className="text-sm leading-6 text-ink-muted">{copy.body}</p>

      {visibleReason && (
        <div className="mt-5 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3">
          <p className="text-xs font-semibold text-danger">제한 사유</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{visibleReason}</p>
        </div>
      )}

      <p className="mt-5 text-xs leading-5 text-ink-muted">
        해제가 필요하거나 사실과 다른 경우 관리자에게 문의해주세요. 보안을 위해 내부
        처리 기록과 관리자 정보는 이 화면에 표시하지 않습니다.
      </p>

      <form action={logoutAction} className="mt-6">
        <Button type="submit" variant="secondary" className="w-full">
          로그아웃
        </Button>
      </form>
    </Card>
  );
}
