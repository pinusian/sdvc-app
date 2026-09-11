-- [P6-2] usage_logs — 개발자별 토큰 사용량과 원가 기록
--
-- 두 곳에서 쓴다:
--   ① 등급별 월 한도 판정 (FR-026, [P6-3])
--   ② 원가 모니터링 ([P8-3])
-- 값은 우리가 추정하지 않고 **Anthropic이 알려준 실제 사용량**을 그대로 남긴다.

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 어떤 대화/프로젝트에서 썼는지. 나중에 지워져도 사용량 기록은 남겨야
  -- 월 합계가 흔들리지 않으므로 set null.
  conversation_id uuid references public.conversations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,

  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),

  -- 그때의 단가로 계산한 원가(달러). 단가가 나중에 바뀌어도 과거 기록은
  -- 그대로 남아야 하므로 계산 결과를 저장한다.
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),

  created_at timestamptz not null default now()
);

comment on table public.usage_logs is
  'Claude API 사용량·원가 기록. 등급별 월 한도 판정(FR-026)과 원가 모니터링(P8-3)의 근거.';

-- 월 합계를 구할 때 쓰는 색인 (사용자별 + 기간)
create index if not exists usage_logs_user_created_idx
  on public.usage_logs (user_id, created_at desc);

-- 행 수준 보안: 켜되 정책은 두지 않는다 — 서버(secret key)만 읽고 쓴다.
-- 사용량은 과금 근거라 브라우저에서 건드릴 수 있으면 안 된다.
alter table public.usage_logs enable row level security;
