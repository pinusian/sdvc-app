import Link from "next/link";

/**
 * [P10-2a] 개인정보 처리방침 (FR-037).
 *
 * 무료로 쓰더라도 이메일을 받는 순간 개인정보보호법이 적용된다.
 * **이용약관·환불정책은 여기 없다** — 돈을 받지 않는 동안은 약속할 것이 없고,
 * 사업 전환 때 실제 조건에 맞춰 쓰는 편이 낫다(Clarify 25).
 *
 * 이 문서는 지금 실제로 하는 일만 적는다. 하지 않는 일을 적어두면 그것도 약속이 된다.
 */

const UPDATED = "2026년 9월 12일";

export default function PrivacyPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-7 py-4">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          SDVC
        </Link>
        <Link href="/login" className="text-sm text-ink-muted hover:text-accent-ink">
          로그인
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-7 py-12">
        <h1 className="mb-2">개인정보 처리방침</h1>
        <p className="mb-8 text-sm text-ink-muted">마지막 수정: {UPDATED}</p>

        <div className="space-y-7 text-sm leading-relaxed text-ink">
          <section>
            <h2 className="mb-2 text-base font-semibold">무엇을 받나요</h2>
            <ul className="list-disc space-y-1 pl-5 text-ink-muted">
              <li>
                <strong className="text-ink">이메일 주소</strong> — 가입할 때 직접 적어주시는 것
              </li>
              <li>
                <strong className="text-ink">비밀번호</strong> — 원문은 저장하지 않습니다. 확인용
                값(해시)만 남습니다
              </li>
              <li>
                <strong className="text-ink">만드신 내용</strong> — AI와 나눈 대화, 만들어진
                홈페이지 파일, 붙이신 이미지·글파일
              </li>
              <li>
                <strong className="text-ink">사용량 기록</strong> — 언제 얼마나 쓰셨는지(요금·한도
                계산에 씁니다)
              </li>
            </ul>
            <p className="mt-2 text-ink-muted">
              이름·전화번호·주소·주민등록번호는 받지 않습니다.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold">왜 받나요</h2>
            <p className="text-ink-muted">
              계정을 알아보고(로그인), 만드신 것을 돌려드리고, 쓰신 만큼을 세기 위해서입니다.
              광고에 쓰지 않고, 다른 곳에 팔지 않습니다.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold">어디에 두나요</h2>
            <p className="text-ink-muted">
              Supabase(데이터베이스·파일 저장소)와 Vercel(웹 서버)에 둡니다. 두 곳 모두 해외에
              서버가 있습니다. AI 답변을 만들 때 <strong className="text-ink">보내신 내용이
              Anthropic(Claude)에 전달</strong>됩니다 — 이것이 서비스의 동작 방식입니다.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold">언제 지우나요</h2>
            <ul className="list-disc space-y-1 pl-5 text-ink-muted">
              <li>탈퇴하시면 계정과 함께 대화·파일을 지웁니다</li>
              <li>
                체험이 끝나거나 구독을 해지하시면 만드신 홈페이지는 먼저 비공개로 바뀌고, 유예
                기간(체험 10일 / 해지 30일)이 지나면 삭제됩니다
              </li>
              <li>사용량 기록은 요금 계산과 정산 확인을 위해 그보다 오래 남을 수 있습니다</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold">직접 하실 수 있는 것</h2>
            <p className="text-ink-muted">
              프로젝트는 대시보드에서 언제든 지우실 수 있습니다. 계정 삭제나 보관 중인 내용의
              열람·정정은 아래로 알려주시면 처리합니다.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold">문의</h2>
            <p className="text-ink-muted">
              개인정보 관련 문의: <strong className="text-ink">pinusian@gmail.com</strong>
            </p>
          </section>

          <section className="rounded-lg border border-border bg-surface-muted p-4">
            <p className="text-ink-muted">
              SDVC는 현재 <strong className="text-ink">교육용으로 무료 운영</strong> 중입니다.
              결제 기능은 시험 상태이며 실제로 요금이 청구되지 않습니다. 유료로 전환할 때는
              이용약관·환불정책을 함께 안내하고 이 방침도 다시 알려드립니다.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
