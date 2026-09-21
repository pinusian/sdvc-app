create unique index if not exists test_evidence_immutable_version_idx
  on public.test_evidence (run_id, phase, code_hash, test_hash);

alter table public.run_events
  add column if not exists dedupe_key text;

create unique index if not exists run_events_dedupe_idx
  on public.run_events (run_id, dedupe_key)
  where dedupe_key is not null;

drop function if exists public.append_run_event(uuid, text, jsonb, timestamptz);

create or replace function public.append_run_event(
  p_run_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_dedupe_key text default null,
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

  if p_dedupe_key is not null then
    select * into v_event from public.run_events
      where run_id = p_run_id and dedupe_key = p_dedupe_key;
    if v_event.id is not null then return next v_event; return; end if;
  end if;

  select coalesce(max(sequence), 0) + 1 into v_sequence
    from public.run_events where run_id = p_run_id;
  insert into public.run_events (
    run_id, sequence, event_type, payload, dedupe_key, created_at
  ) values (
    p_run_id, v_sequence, p_event_type, coalesce(p_payload, '{}'::jsonb),
    p_dedupe_key, p_created_at
  )
  returning * into v_event;
  return next v_event;
end;
$$;

revoke all on function public.append_run_event(uuid, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.append_run_event(uuid, text, jsonb, text, timestamptz)
  to service_role;

create or replace function public.finish_persistent_run(
  p_run_id uuid,
  p_worker_id text,
  p_status text,
  p_finished_at timestamptz
)
returns setof public.runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.runs%rowtype;
begin
  if p_status not in ('cancelled', 'succeeded', 'failed') then
    raise exception '올바르지 않은 최종 작업 상태입니다.';
  end if;

  update public.runs
    set status = case
          when cancellation_requested_at is not null then 'cancelled'
          else p_status
        end,
        lease_expires_at = null,
        updated_at = p_finished_at
    where id = p_run_id
      and lease_owner = p_worker_id
      and status in ('running', 'cancel_requested')
    returning * into v_run;

  if v_run.id is null then
    raise exception '유효한 작업 lease를 찾을 수 없습니다.';
  end if;

  return next v_run;
end;
$$;

revoke all on function public.finish_persistent_run(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finish_persistent_run(uuid, text, text, timestamptz)
  to service_role;
