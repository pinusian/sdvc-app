create or replace function public.approve_document_and_advance(
  p_project_id uuid,
  p_kind text,
  p_version_id uuid,
  p_approved_by uuid,
  p_approved_at timestamptz default now()
)
returns table (
  approval_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  current_stage text,
  created boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_stage text;
  v_latest_version_id uuid;
  v_approval_id uuid;
  v_approved_by uuid;
  v_approved_at timestamptz;
  v_next_stage text;
  v_created boolean := false;
begin
  if p_kind not in ('plan', 'tasks') then
    raise exception '승인할 수 없는 문서 종류입니다.';
  end if;
  v_next_stage := case p_kind when 'plan' then 'tasks' else 'analyze' end;

  select workflow.current_stage
    into v_stage
    from public.document_workflows as workflow
    where workflow.project_id = p_project_id
    for update;

  if not found then
    raise exception '문서 workflow를 찾을 수 없습니다.';
  end if;
  select version_row.id
    into v_latest_version_id
    from public.document_versions as version_row
    where version_row.project_id = p_project_id
      and version_row.kind = p_kind
    order by version_row.version desc
    limit 1;

  if v_latest_version_id is null or v_latest_version_id <> p_version_id then
    raise exception '최신 문서 버전만 승인할 수 있습니다.';
  end if;

  -- 첫 요청이 workflow 잠금을 해제한 뒤 들어온 동일 요청은 기존 결과를 돌려준다.
  if v_stage = v_next_stage then
    select approval.id, approval.approved_by, approval.approved_at
      into v_approval_id, v_approved_by, v_approved_at
      from public.document_approvals as approval
      where approval.project_id = p_project_id
        and approval.kind = p_kind
        and approval.version_id = p_version_id
        and approval.invalidated_at is null;

    if v_approval_id is not null then
      return query
        select v_approval_id, v_approved_by, v_approved_at, v_next_stage, false;
      return;
    end if;
  end if;

  if v_stage <> p_kind then
    raise exception '현재 SDVC 단계가 요청과 일치하지 않습니다.';
  end if;

  insert into public.document_approvals (
    project_id,
    kind,
    version_id,
    approved_by,
    approved_at
  ) values (
    p_project_id,
    p_kind,
    p_version_id,
    p_approved_by,
    p_approved_at
  )
  on conflict (project_id, kind, version_id) do nothing
  returning id, document_approvals.approved_by, document_approvals.approved_at
    into v_approval_id, v_approved_by, v_approved_at;

  if v_approval_id is not null then
    v_created := true;
  else
    select approval.id, approval.approved_by, approval.approved_at
      into v_approval_id, v_approved_by, v_approved_at
      from public.document_approvals as approval
      where approval.project_id = p_project_id
        and approval.kind = p_kind
        and approval.version_id = p_version_id
        and approval.invalidated_at is null;

    if v_approval_id is null then
      raise exception '무효화된 문서 버전은 다시 승인할 수 없습니다.';
    end if;
  end if;

  update public.document_workflows
    set current_stage = v_next_stage,
        updated_at = p_approved_at
    where project_id = p_project_id
      and current_stage = p_kind;

  return query
    select v_approval_id, v_approved_by, v_approved_at, v_next_stage, v_created;
end;
$$;

revoke all on function public.approve_document_and_advance(
  uuid, text, uuid, uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.approve_document_and_advance(
  uuid, text, uuid, uuid, timestamptz
) to service_role;

comment on function public.approve_document_and_advance(
  uuid, text, uuid, uuid, timestamptz
) is '최신 Plan/Tasks 승인을 멱등 저장하고 workflow 단계를 같은 트랜잭션에서 전진시킨다.';
