-- [P2-4] profiles — 역할(role)·등급(grade)·구독상태
-- 3계층 역할 중 '사용자'는 이 표에 없다(MVP에서 계정을 만들지 않으므로).
-- 여기서는 서버관리자/개발자만 다룬다.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'developer'
    check (role in ('admin', 'developer')),
  grade text not null default 'trial'
    check (grade in ('trial', 'basic', 'pro')),
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  stripe_customer_id text,
  subscription_status text not null default 'none'
    check (subscription_status in ('none', 'trialing', 'active', 'past_due', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'SDVC 개발자·서버관리자 프로필. auth.users와 1:1. 신규가입 시 트리거로 자동 생성됨. 등급별 한도(FR): 체험=프로젝트1개/월50만토큰, 기본=3개/월200만토큰, 프로=10개/월800만토큰(WBS 게이트 G2, 2026-09-10 확정).';

-- 행 수준 보안: 기본적으로 자기 자신의 행만 읽고/고칠 수 있다.
-- 관리자용 전체 조회는 SUPABASE_SECRET_KEY를 쓰는 서버측 관리자 클라이언트가
-- RLS를 우회해서 처리한다([P8-2]에서 실제 화면 구현).
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 신규 가입(auth.users insert) 시 profiles 행을 자동 생성.
-- role은 일단 'developer'로 만들고, ADMIN_EMAIL 일치 여부에 따른 승격은
-- 애플리케이션 코드([P2-7])에서 처리한다 — DB 트리거에 환경변수를
-- 직접 넘기지 않는 편이 더 단순하고 안전하다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
