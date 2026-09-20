create table if not exists public.provider_credentials (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider = 'openai'),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version text not null,
  last_four text not null check (char_length(last_four) = 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);

alter table public.provider_credentials enable row level security;
revoke all on public.provider_credentials from anon, authenticated;

comment on table public.provider_credentials is
  '서버 전용 수강생 OpenAI 자격 암호문. 브라우저와 authenticated 역할의 직접 조회를 금지한다.';
