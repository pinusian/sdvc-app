-- [P4-2] projects — 만들어진 산출물(홈페이지) 한 건의 메타 정보
--
-- 대화(conversations)가 "어떻게 만들었나"의 기록이라면, projects는
-- "무엇이 만들어졌나"다. 실제 파일은 Storage의 artifacts 버킷
-- `{project_id}/...` 아래에 들어가고, 이 표는 그 파일들의 주인·주소·
-- 공개범위를 관리한다.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,

  -- 산출물 주소. /site/{slug} 로 열린다. 전체에서 고유해야 한다.
  -- 소문자·숫자·하이픈만, 3~40자 (URL에 그대로 들어가므로 제한한다).
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40),

  -- 공개범위(FR-007): 비공개=소유자만 / 링크공개=주소를 아는 누구나 /
  -- 전체공개=검색 노출 포함 누구나.
  visibility text not null default 'private'
    check (visibility in ('private', 'link', 'public')),

  -- 만드는 중인지 다 됐는지. 파일 저장이 끝나면 'deployed'가 된다.
  status text not null default 'draft'
    check (status in ('draft', 'building', 'deployed', 'failed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.projects is
  'SDVC 산출물 프로젝트. 파일은 Storage artifacts 버킷의 {id}/ 아래에 저장된다. slug는 /site/{slug} 주소가 되므로 전체 고유.';

create index if not exists projects_owner_id_idx
  on public.projects (owner_id, created_at desc);

-- /site/{slug} 서빙이 slug로 바로 찾으므로 unique 제약이 곧 색인 역할을 한다.

-- 대화와 프로젝트 연결: [P3-4]에서 자리만 비워둔 conversations.project_id에
-- 이제 실제 외래키를 건다. 프로젝트를 지워도 대화 기록은 남긴다(set null).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_project_id_fkey'
  ) then
    alter table public.conversations
      add constraint conversations_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end $$;

-- 행 수준 보안: 켜되 정책은 두지 않는다.
-- 브라우저(publishable key)에서는 아무것도 못 읽고 못 쓴다. 공개범위 판단은
-- /site/{slug} 라우트에서 서버가 secret key로 읽어 처리한다 — 공개 여부를
-- DB 정책이 아니라 애플리케이션 한 곳에서 판단해야 [P9] 구독 해지 시
-- 즉시 비공개 전환(FR-023) 같은 규칙을 한 군데서 지킬 수 있다.
alter table public.projects enable row level security;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
