-- [P6-7] 구독 해지·체험 만료 시 산출물 처리 (FR-023, FR-027)
--
-- 정책: 즉시 비공개 → 유예 후 삭제 (해지 30일 / 체험 만료 10일).
-- 유예 안에 결제하면 **원래 공개범위 그대로 복구**되어야 하므로,
-- 잠글 때 원래 값을 기억해 둔다.

-- 언제 잠갔고, 언제까지 유예인지
alter table public.profiles
  add column if not exists artifacts_locked_at timestamptz,
  add column if not exists artifacts_purge_after timestamptz;

comment on column public.profiles.artifacts_locked_at is
  '[P6-7] 해지·체험만료로 산출물을 비공개 전환한 시각. null이면 잠기지 않음.';
comment on column public.profiles.artifacts_purge_after is
  '[P6-7] 이 시각이 지나면 산출물을 삭제한다 (해지 30일 / 체험 만료 10일 뒤).';

-- 잠그기 직전의 공개범위 — 복구할 때 되돌릴 값
alter table public.projects
  add column if not exists locked_from_visibility text
    check (locked_from_visibility in ('private', 'link', 'public'));

comment on column public.projects.locked_from_visibility is
  '[P6-7] 잠기기 전 공개범위. 결제로 복구할 때 이 값으로 되돌린다. null이면 잠기지 않은 상태.';

-- 유예 만료 대상을 찾을 때 쓰는 색인
create index if not exists profiles_purge_after_idx
  on public.profiles (artifacts_purge_after)
  where artifacts_purge_after is not null;
