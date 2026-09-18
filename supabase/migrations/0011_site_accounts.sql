-- [P11-1] 사용자(방문자) 계정 — 산출물마다 격리된 로그인·기록
--
-- "시스템관리자 — 개발자 — 사용자" 세 층 중 마지막 층이다(교육 맥락에서는
-- 각각 교수·학생이라고도 부른다). 개발자 계정(profiles·auth.users)과는
-- 완전히 분리한다 — 섞으면 사용자가 실수로 개발자 로그인 화면으로 들어가거나,
-- Supabase Auth의 이메일 인증 발송 한도에 다시 걸릴 수 있다([P2-9]에서 실제로
-- 겪었다). 그래서 이 표는 Supabase Auth를 안 쓰고 비밀번호를 직접 해시해 둔다.
--
-- 격리는 지금까지와 같은 원칙: RLS는 켜되 정책은 두지 않는다(=브라우저 직접
-- 접근 불가). 여기 오는 클라이언트는 secret key를 쓰는 서버뿐이고, project_id
-- 조건은 서버 코드가 매번 직접 건다.

create table if not exists public.site_users (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null,
  -- scrypt 해시. 평문 비밀번호는 어디에도 저장하지 않는다.
  password_hash text not null,
  display_name text,
  -- [P11-4] 사용자 본인의 Anthropic API 키 — 대칭 암호화해서 저장한다(해시가
  -- 아니다, 실제로 복호화해서 다시 써야 하므로). 비어 있으면 그 사용자에게는
  -- AI 기능이 막힌다. 과금은 이 키의 주인(사용자) 앞으로 나간다 — 이 서버나
  -- 개발자에게 나가지 않는다.
  anthropic_api_key_encrypted text,
  suspended_at timestamptz,
  suspended_reason text,
  created_at timestamptz not null default now()
);

comment on table public.site_users is
  '산출물(프로젝트) 하나에 속한 방문자(사용자) 계정. 개발자 계정과는 분리된 별도 로그인 체계.';
comment on column public.site_users.anthropic_api_key_encrypted is
  '사용자 본인의 Anthropic API 키(대칭 암호화, SITE_API_KEY_ENCRYPTION_SECRET로 암복호화). 과금은 사용자 본인 부담.';
comment on column public.site_users.suspended_at is
  '개발자가 이 사용자 하나를 막은 시각(FR-0xx). null이면 정상 — profiles.suspended_at과 같은 원칙.';

-- 같은 프로젝트 안에서만 이메일이 유일하면 된다(프로젝트가 다르면 같은 이메일 재사용 가능).
create unique index if not exists site_users_project_email_idx
  on public.site_users (project_id, lower(email));

alter table public.site_users enable row level security;

create table if not exists public.site_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  site_user_id uuid not null references public.site_users(id) on delete cascade,
  title text not null,
  author text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.site_records is
  '사용자가 작성한 기록(예: 독서 기록) 1건. project_id·site_user_id 둘 다로 격리한다.';

create index if not exists site_records_owner_idx
  on public.site_records (project_id, site_user_id, created_at desc);

alter table public.site_records enable row level security;

-- [P11-6] 개발자가 프로젝트 하나의 사용자 로그인을 통째로 켜고 끈다(예: 학기
-- 종료 후 잠금). 기본은 켜짐 — 이미 배포된 프로젝트가 갑자기 막히면 안 된다.
alter table public.projects
  add column if not exists site_login_enabled boolean not null default true;

comment on column public.projects.site_login_enabled is
  '이 프로젝트의 사용자(방문자) 로그인 기능 전체를 개발자가 켜고 끈다.';
