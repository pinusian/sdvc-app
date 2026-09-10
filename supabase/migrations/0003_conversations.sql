-- [P3-4] conversations / messages — SDVC 대화 상태 저장
--
-- 세션이 끊겨도 이어서 진행할 수 있도록, 어디까지 진행했는지(current_block)와
-- 주고받은 메시지를 서버에 남긴다. Claude Code의 docs/progress.md가 하던
-- 역할을 웹서비스에서는 이 두 표가 대신한다.
--
-- 소유자는 projects가 아니라 auth.users를 직접 가리킨다. projects 표는
-- [P4-2](슬라이스 3)에서 만들기 때문이다. project_id 칼럼은 그때
-- 연결할 자리를 미리 비워둔 것이다.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,                                   -- [P4-2]에서 projects 연결
  title text,
  current_block text not null default 'constitution_specify'
    check (current_block in (
      'constitution_specify', 'clarify', 'plan', 'tasks', 'implement', 'done'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.conversations is
  'SDVC 진행대본 대화 1건. current_block은 5블록 상태기계의 현재 위치([P3-3] src/lib/sdvc/blocks.ts와 값이 일치해야 함).';

create index if not exists conversations_owner_id_idx
  on public.conversations (owner_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

comment on table public.messages is
  'SDVC 대화 메시지. role은 user/assistant만 — system(진행대본)은 서버가 매번 새로 만들어 붙이므로 저장하지 않는다.';

create index if not exists messages_conversation_id_idx
  on public.messages (conversation_id, created_at);

-- 행 수준 보안: 두 표 모두 켜되 정책은 만들지 않는다.
-- 즉 publishable key(브라우저)로는 아무것도 읽거나 쓸 수 없고,
-- 서버 코드가 SUPABASE_SECRET_KEY로 소유자 조건을 직접 걸어 접근한다.
-- ([P2-7]에서 profiles 자기수정 허점을 겪은 뒤 정한 원칙 — 쓰기는 서버만.)
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();
