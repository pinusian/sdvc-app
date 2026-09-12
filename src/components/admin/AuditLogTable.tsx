import type { AuditViewRow } from "@/lib/admin/audit-view";

/**
 * [P8-7e] 감사 기록 화면 (FR-041).
 *
 * 이 화면이 답해야 하는 질문은 하나다: **누가 언제 누구에게 무엇을 했나.**
 *
 * 서버 컴포넌트로 둔다 — 거르기는 평범한 GET 폼으로 하므로 자바스크립트가
 * 필요 없고, 기록은 브라우저에 내려보낼 것이 적을수록 좋다.
 */

interface Props {
  rows: AuditViewRow[];
  /** 접어둔 화면 열람 건수 */
  hiddenCount: number;
}

export function AuditLogTable({ rows, hiddenCount }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-ink-muted">조건에 맞는 기록이 없습니다.</p>
        {hiddenCount > 0 && (
          <p className="mt-1 text-xs text-ink-faint">화면 열람 {hiddenCount}건은 접었습니다.</p>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {/* 넓은 표는 화면 밖으로 삐져나가지 않고 제 안에서 넘어간다 */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-xs text-ink-muted">
              <th className="px-4 py-2.5 font-medium">언제</th>
              <th className="px-4 py-2.5 font-medium">누가</th>
              <th className="px-4 py-2.5 font-medium">무엇을</th>
              <th className="px-4 py-2.5 font-medium">누구에게</th>
              <th className="px-4 py-2.5 font-medium">내용</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-b-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-ink-muted">
                  {row.atText}
                </td>
                <td className="px-4 py-2.5 text-xs text-ink">{row.actor}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                  <span className="text-ink">{row.action}</span>
                  {!row.succeeded && (
                    <span className="ml-1.5 rounded-pill bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                      거부됨
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-ink-muted">{row.target ?? ""}</td>
                <td className="px-4 py-2.5 text-xs text-ink-muted">{row.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 감췄다는 사실까지 감추면 그 자체가 감사 기록의 구멍이 된다 */}
      {hiddenCount > 0 && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-ink-faint">
          화면 열람 {hiddenCount}건은 접었습니다. 위 &lsquo;화면 열람 포함&rsquo;을 켜면 함께 보입니다.
        </p>
      )}
    </div>
  );
}
