-- [P7-4b] 유지보수 블록을 대화 상태에 허용한다 (FR-029, BL-001)
--
-- 구현을 마친 대화는 이제 'done'이 아니라 'maintenance'로 간다.
-- 0003에서 만든 CHECK 제약에 그 값이 없어 **쓰는 순간 거부됐다** —
-- 단위 테스트는 저장소를 목으로 대체하고, e2e는 이미 'done'인 행만 써서
-- 이 구간을 아무도 지나가지 않았다([P7-9] 검증에서 실제 DB로 드러남).
--
-- 'done'은 남겨둔다. 이미 그 값으로 저장된 대화가 있고, 코드가 읽을 때
-- 유지보수로 바꿔 읽는다(resolveBlock) — 데이터를 건드리지 않는 쪽이 안전하다.

alter table public.conversations
  drop constraint if exists conversations_current_block_check;

alter table public.conversations
  add constraint conversations_current_block_check
  check (current_block in (
    'constitution_specify', 'clarify', 'plan', 'tasks', 'implement', 'maintenance', 'done'
  ));

comment on table public.conversations is
  'SDVC 진행대본 대화 1건. current_block은 6블록 상태기계의 현재 위치([P3-3] src/lib/sdvc/blocks.ts와 값이 일치해야 함). done은 [P7-4b] 이전에 저장된 옛 값.';
