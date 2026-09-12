-- [P8-5] 플랫폼 신고 (FR-013·042·043·044)
--
-- Clarify 17에서 "받아만 두고 아무도 안 보면 신고한 사람에게 더 나쁘다"며
-- 보내는 쪽(P7-5)과 보는 쪽(P8-5)을 **함께** 만들기로 미뤄둔 건이다.
--
-- 코드보다 스키마를 먼저 놓는다 — [P7-9]에서 코드만 바꾸고 스키마를 안 바꿔
-- 쓰기가 거부된 일이 있었다(BL-004b).

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),

  -- **지우지 않고 남긴다.** cascade로 지우면 불법 콘텐츠를 신고한 사람이
  -- 탈퇴하는 순간 단서가 통째로 사라진다. 신고자는 잃되 신고는 남긴다.
  reporter_id uuid references auth.users(id) on delete set null,
  -- 신고 당시의 주소. 계정이 사라져도 누가 신고했는지의 흔적은 남는다.
  reporter_email text,

  category text not null
    check (category in ('bug', 'content', 'account', 'other')),
  body text not null
    check (char_length(btrim(body)) between 10 and 2000),

  -- 어디서 겪었는지. 산출물 신고면 주소로 프로젝트를 짚어 바로 가릴 수 있다.
  target_url text,
  target_project_id uuid references public.projects(id) on delete set null,

  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'rejected')),
  -- 신고한 사람에게 **그대로 보이는 답**이다 (FR-013·044).
  admin_note text,
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.reports is
  '플랫폼 신고(FR-013). 신고자가 탈퇴해도 신고는 남는다 — 증거가 사라지면 안 된다.';
comment on column public.reports.admin_note is
  '처리 결과. 신고한 사람에게 그대로 보인다(FR-044) — 내부 메모를 쓰는 칸이 아니다.';

-- 접수함은 "안 끝난 것 먼저, 최신부터"로 본다.
create index if not exists reports_status_created_idx
  on public.reports (status, created_at desc);
-- 내 신고 목록.
create index if not exists reports_reporter_idx
  on public.reports (reporter_id, created_at desc);

-- 다른 표들과 같다: RLS를 켜고 **정책은 두지 않는다** = 서버 전용.
-- 신고 내용은 남의 산출물에 대한 고발일 수 있다 — 브라우저 키로는 한 줄도
-- 읽히면 안 된다.
alter table public.reports enable row level security;
