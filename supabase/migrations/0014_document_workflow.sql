create table if not exists public.document_workflows (
  project_id uuid primary key references public.projects(id) on delete cascade,
  current_stage text not null default 'constitution'
    check (current_stage in (
      'constitution', 'specify', 'clarify', 'plan', 'tasks', 'analyze', 'implement'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null
    check (kind in ('constitution', 'spec', 'clarifications', 'plan', 'tasks')),
  version integer not null check (version > 0),
  content text not null check (char_length(content) > 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (project_id, kind, version),
  unique (id, project_id, kind)
);

create table if not exists public.document_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('plan', 'tasks')),
  version_id uuid not null,
  approved_by uuid not null references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  invalidated_at timestamptz,
  unique (project_id, kind, version_id),
  foreign key (version_id, project_id, kind)
    references public.document_versions(id, project_id, kind) on delete cascade
);

create index if not exists document_versions_latest_idx
  on public.document_versions (project_id, kind, version desc);
create index if not exists document_approvals_active_idx
  on public.document_approvals (project_id, kind, version_id)
  where invalidated_at is null;

alter table public.document_workflows enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_approvals enable row level security;

revoke all on public.document_workflows from anon, authenticated;
revoke all on public.document_versions from anon, authenticated;
revoke all on public.document_approvals from anon, authenticated;

comment on table public.document_versions is
  '프로젝트별 SDVC 구조화 문서의 불변 버전. 내용 해시와 증가 버전을 함께 보존한다.';
comment on table public.document_approvals is
  '최신 Plan/Tasks 문서 버전에 결부된 승인. 문서 변경 시 invalidated_at으로 무효화한다.';
