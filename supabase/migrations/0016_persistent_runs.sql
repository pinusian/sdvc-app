create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_bundle_hash text not null check (document_bundle_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (char_length(trim(idempotency_key)) > 0),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'cancel_requested', 'cancelled', 'succeeded', 'failed')),
  cancellation_requested_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create table if not exists public.run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, sequence)
);

create table if not exists public.test_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  phase text not null check (phase in ('red', 'green', 'refactor')),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  test_hash text not null check (test_hash ~ '^[a-f0-9]{64}$'),
  command text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  exit_code integer not null,
  log_path text,
  created_at timestamptz not null default now()
);

create index if not exists runs_owner_status_idx on public.runs (owner_id, status, updated_at desc);
create index if not exists runs_lease_idx on public.runs (status, lease_expires_at);
create index if not exists run_events_run_sequence_idx on public.run_events (run_id, sequence);
create index if not exists test_evidence_run_phase_idx on public.test_evidence (run_id, phase, created_at);

alter table public.runs enable row level security;
alter table public.run_events enable row level security;
alter table public.test_evidence enable row level security;

revoke all on public.runs from anon, authenticated;
revoke all on public.run_events from anon, authenticated;
revoke all on public.test_evidence from anon, authenticated;

create or replace function public.create_persistent_run(
  p_owner_id uuid,
  p_project_id uuid,
  p_document_bundle_hash text,
  p_idempotency_key text,
  p_now timestamptz default now()
)
returns setof public.runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.runs%rowtype;
begin
  insert into public.runs (
    owner_id, project_id, document_bundle_hash, idempotency_key, status, created_at, updated_at
  ) values (
    p_owner_id, p_project_id, p_document_bundle_hash, p_idempotency_key, 'queued', p_now, p_now
  )
  on conflict (owner_id, idempotency_key) do nothing
  returning * into v_run;

  if v_run.id is null then
    select * into v_run from public.runs
      where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
    if v_run.project_id <> p_project_id or v_run.document_bundle_hash <> p_document_bundle_hash then
      raise exception '같은 멱등키를 다른 프로젝트나 문서 묶음에 사용할 수 없습니다.';
    end if;
  end if;

  return next v_run;
end;
$$;

create or replace function public.claim_run_lease(
  p_run_id uuid,
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz
)
returns setof public.runs
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.runs
    set status = 'running',
        lease_owner = p_worker_id,
        lease_expires_at = p_lease_expires_at,
        updated_at = p_now
    where id = p_run_id
      and status in ('queued', 'running')
      and cancellation_requested_at is null
      and (lease_expires_at is null or lease_expires_at <= p_now or lease_owner = p_worker_id)
    returning *;
$$;

create or replace function public.append_run_event(
  p_run_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_created_at timestamptz default now()
)
returns setof public.run_events
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sequence bigint;
  v_event public.run_events%rowtype;
begin
  perform 1 from public.runs where id = p_run_id for update;
  if not found then raise exception '작업을 찾을 수 없습니다.'; end if;

  select coalesce(max(sequence), 0) + 1 into v_sequence
    from public.run_events where run_id = p_run_id;
  insert into public.run_events (run_id, sequence, event_type, payload, created_at)
    values (p_run_id, v_sequence, p_event_type, coalesce(p_payload, '{}'::jsonb), p_created_at)
    returning * into v_event;
  return next v_event;
end;
$$;

revoke all on function public.create_persistent_run(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_run_lease(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.append_run_event(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.create_persistent_run(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.claim_run_lease(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.append_run_event(uuid, text, jsonb, timestamptz) to service_role;
