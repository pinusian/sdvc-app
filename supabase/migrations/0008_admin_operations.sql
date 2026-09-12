-- [P8-0] 출시 전 최소 운영 수단 (FR-014·016·017·034)
--
-- 사람을 받기 전에 있어야 하는 것들:
--   ① 관리자 등급 (지금은 나 혼자지만, 판정 지점을 미리 한 곳으로 모으기 위해)
--   ② 계정 정지 / 산출물 차단 — **지우지 않고 가린다**(오판 시 되돌리고, 분쟁 시 증거를 남긴다)
--   ③ 감사 로그 — 관리자가 남의 데이터를 열람·변경한 내역
--
-- [P7-9]에서 코드만 바꾸고 스키마를 안 바꿔 쓰기가 거부된 일이 있어,
-- 이번에는 **스키마를 먼저** 놓고 코드를 붙인다.

-- ── ① 관리자 등급 (FR-034) ─────────────────────────────────────────────
-- super    : 전권
-- operator : 사용자관리·차단 가능, 정책변경 불가
-- support  : 읽기 전용
-- 기본값 super — 지금 관리자는 한 사람이고, 등급을 고르는 화면은 아직 없다.
alter table public.profiles
  add column if not exists admin_tier text not null default 'super'
    check (admin_tier in ('super', 'operator', 'support'));

comment on column public.profiles.admin_tier is
  '서버관리자 내부 등급(FR-034). role=admin 일 때만 의미가 있다.';

-- ── ② 계정 정지 (FR-014·016) ───────────────────────────────────────────
-- 정지돼도 **로그인은 된다** — 들어와서 왜 정지됐는지 보고 문의할 수 있어야 한다.
-- 대화·생성·결제는 전부 막히고, 그 사람의 산출물도 함께 가려진다.
alter table public.profiles
  add column if not exists suspended_at timestamptz;
alter table public.profiles
  add column if not exists suspended_reason text;

comment on column public.profiles.suspended_at is
  '계정 정지 시각(FR-014). null이면 정상. 정지돼도 로그인은 되고 기능만 막힌다.';

-- ── ③ 산출물 비상 차단 (FR-016) ────────────────────────────────────────
-- 지우지 않고 가린다. /site/{주소}는 403이 아니라 **404**를 낸다
-- (존재 자체를 숨긴다 — [P5-1] canViewArtifact와 같은 원칙).
alter table public.projects
  add column if not exists blocked_at timestamptz;
alter table public.projects
  add column if not exists blocked_reason text;

comment on column public.projects.blocked_at is
  '비상 차단 시각(FR-016). null이면 정상. 차단해도 파일은 지우지 않는다.';

-- ── ④ 감사 로그 (FR-017) ───────────────────────────────────────────────
-- 관리자가 **무엇을 보았는지까지** 남긴다. 분쟁에서 "남의 대화를 엿보았느냐"는
-- 변경만큼 중요한 질문이다.
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,                    -- 예: developer:read, artifact:block
  target_type text,                        -- 예: profile, project
  target_id text,
  succeeded boolean not null default true, -- 거부된 시도도 남긴다
  detail jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_logs is
  '서버관리자의 열람·변경 기록(FR-017). 거부된 시도도 남긴다 — 누가 무엇을 하려 했는지가 증거다.';

create index if not exists admin_audit_logs_actor_idx
  on public.admin_audit_logs (actor_id, created_at desc);
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs (target_type, target_id, created_at desc);

-- RLS는 켜되 **정책을 두지 않는다** = 서버(secret key)만 접근.
-- 감사 로그를 당사자가 지울 수 있으면 증거가 아니다.
alter table public.admin_audit_logs enable row level security;
