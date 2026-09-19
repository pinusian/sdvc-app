-- [T014] 수강생 접근 경계 상태와 감사 증거 (FR-020·022·023·024)
--
-- 기존 0008의 suspended_at/reason과 admin_audit_logs를 재사용한다.
-- 이번 마이그레이션은 로그인 세션과 별개로 매 요청 판정에 필요한 활성 상태,
-- 차단 수행자, 변경 전후 상태를 보강한다. RLS 정책은 넓히지 않는다.

-- 인증 사용자는 남아 있지만 서비스 이용 자격을 비활성화할 수 있다.
-- suspended_at은 정책 위반 차단, is_active=false는 탈퇴 대기·운영 비활성 등
-- 더 넓은 계정 수명주기에 사용하며 둘 중 하나라도 걸리면 보호 API를 막는다.
alter table public.profiles
  add column if not exists is_active boolean not null default true;

alter table public.profiles
  add column if not exists suspended_by uuid references auth.users(id) on delete set null;

alter table public.profiles
  add column if not exists access_state_changed_at timestamptz;

comment on column public.profiles.is_active is
  '수강생 서비스 활성 상태(T014). false이면 로그인 세션이 남아 있어도 보호 API를 거부한다.';
comment on column public.profiles.suspended_by is
  '가장 최근 계정 차단을 수행한 관리자. 관리자 삭제 시 계정 상태는 유지하고 참조만 null 처리한다.';
comment on column public.profiles.access_state_changed_at is
  'is_active 또는 suspended_at 상태가 마지막으로 바뀐 시각.';

-- 관리 화면의 활성 수강생 조회를 위한 부분 인덱스. 역할의 DB 값 developer는
-- 제품 화면의 수강생을 뜻한다(기존 데이터 호환 규칙).
create index if not exists profiles_active_learner_idx
  on public.profiles (created_at desc)
  where role = 'developer' and is_active = true and suspended_at is null;

-- 기존 감사 로그에 차단·해제의 이유와 상태 전후를 독립 필드로 남긴다.
-- detail jsonb만 사용하면 필드 이름이 호출자마다 달라져 누락을 찾기 어렵다.
alter table public.admin_audit_logs
  add column if not exists reason text;

alter table public.admin_audit_logs
  add column if not exists previous_state jsonb;

alter table public.admin_audit_logs
  add column if not exists next_state jsonb;

comment on column public.admin_audit_logs.reason is
  '차단·해제 등 상태 변경 사유. 상태 변경 API는 빈 사유를 허용하지 않는다.';
comment on column public.admin_audit_logs.previous_state is
  '관리 작업 직전의 역할·활성·차단 상태 스냅샷.';
comment on column public.admin_audit_logs.next_state is
  '관리 작업 직후의 역할·활성·차단 상태 스냅샷.';

create index if not exists admin_audit_logs_access_change_idx
  on public.admin_audit_logs (target_id, created_at desc)
  where action in ('developer:suspend', 'developer:unsuspend', 'developer:activate', 'developer:deactivate');
