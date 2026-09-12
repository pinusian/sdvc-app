-- [P10-0] 교육용 운영 (FR-035·036)
--
-- 당분간 교육용으로 쓴다 — 수강생이 직접 실습하고, 실결제는 사업자등록 뒤로 미룬다.
-- 그래서 두 가지가 필요하다:
--   ① 결제 없이 등급을 부여하기 (기간을 정해서)
--   ② 한 사람이 폭주하지 않게 계정별 한도를 따로 걸기
--
-- [P7-9]·[P8-0]과 같이 **스키마를 먼저** 놓고 코드를 붙인다.

-- ── ① 등급 부여 (FR-035) ───────────────────────────────────────────────
-- `grade`는 지금처럼 **결제(웹훅)가 관리**한다. 부여는 섞지 않고 따로 둔다 —
-- 섞으면 "결제했는데 강등"·"공짜로 프로"가 생긴다.
--
-- 실효 등급 순서: 구독 active → 결제 등급 / 아니면 살아 있는 부여 / 아니면 체험.
alter table public.profiles
  add column if not exists granted_grade text
    check (granted_grade is null or granted_grade in ('basic', 'pro'));
alter table public.profiles
  add column if not exists granted_until timestamptz;
alter table public.profiles
  add column if not exists granted_reason text;

comment on column public.profiles.granted_grade is
  '운영자가 결제 없이 부여한 등급(FR-035). null이면 부여 없음. grade(결제분)와 섞지 않는다.';
comment on column public.profiles.granted_until is
  '부여 만료 시각. 지나면 무효 — **읽을 때 판정**한다(정리 작업을 기다리면 하루 더 공짜가 된다).';

-- ── ② 계정별 월 한도 (FR-036) ──────────────────────────────────────────
-- null이면 등급 기본값을 쓴다. **0도 유효한 값**이다(완전히 막기) —
-- 코드에서 `?? `가 아니라 `!= null`로 판정해야 하는 이유다.
alter table public.profiles
  add column if not exists monthly_token_limit integer
    check (monthly_token_limit is null or monthly_token_limit >= 0);

comment on column public.profiles.monthly_token_limit is
  '이 계정만의 월 토큰 한도(FR-036). null이면 등급 기본값. 0은 완전 차단이며 null과 다르다.';
