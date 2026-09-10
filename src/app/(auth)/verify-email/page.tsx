import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function VerifyEmailPage() {
  return (
    <Card className="text-center">
      <h1 className="mb-2">메일함을 확인해주세요</h1>
      <p className="mb-6 text-sm text-ink-muted">
        입력하신 이메일로 인증 링크를 보내드렸어요. 링크를 눌러 인증을 완료하면
        로그인하실 수 있습니다. (메일이 안 보이면 스팸함도 확인해주세요)
      </p>
      <Link href="/login">
        <Button variant="secondary" className="w-full">
          로그인 화면으로
        </Button>
      </Link>
    </Card>
  );
}
