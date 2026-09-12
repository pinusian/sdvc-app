# Supabase 마이그레이션

이 폴더의 `.sql` 파일들은 Supabase 프로젝트에 적용해야 하는 데이터베이스 변경 이력이다.
현재는 Supabase CLI 연동 전이므로, **Supabase 대시보드의 SQL Editor에서 직접 실행**한다.

## 실행 방법

1. Supabase 프로젝트 대시보드 → 왼쪽 메뉴 **SQL Editor**
2. **New query** 클릭
3. 적용할 파일(예: `0001_profiles.sql`)의 내용을 그대로 복사해서 붙여넣기
4. **Run** 클릭 (우측 하단 또는 Ctrl+Enter)
5. 하단에 "Success. No rows returned" 같은 메시지가 뜨면 완료

## 적용 이력

| 파일 | 내용 | 적용일 |
|---|---|---|
| `0001_profiles.sql` | `profiles` 테이블(역할·등급·구독상태) + RLS 정책 + 신규가입 자동생성 트리거 | 2026-09-10 적용됨 |
| `0002_profiles_lockdown.sql` | **보안 수정**: 자기수정 정책 제거(권한 탈취 허점 차단). 쓰기는 서버 secret key로만 | 2026-09-10 적용됨 (자기수정 시도 0행 변경으로 확인) |
| `0003_conversations.sql` | `conversations`·`messages` 표. 둘 다 RLS 켜고 정책 없음 = 서버 전용 | 2026-09-10 적용됨 |
| `0004_projects.sql` | `projects` 표(주소 slug·공개범위·상태) + `conversations.project_id` 외래키 연결 | 2026-09-11 적용됨 (제약·RLS 실검증 완료) |
| `0005_usage_logs.sql` | `usage_logs` 표(토큰 사용량·원가) — 등급 한도 판정과 원가 모니터링의 근거 | 2026-09-11 적용됨 (제약·RLS·실제 대화 기록까지 검증) |
| `0006_artifact_lifecycle.sql` | 해지·체험만료 시 산출물 잠금/복구/삭제용 컬럼 (FR-023·FR-027) | 2026-09-12 적용됨 (잠금→복구→삭제 실검증 완료) |

> Storage(파일 저장소) 설정은 SQL이 아니라 `scripts/setup-storage.mjs`로 만든다 — `node scripts/setup-storage.mjs`.
>
> 버킷 2개 (둘 다 **비공개**, 서버 secret key로만 읽고 쓴다):
> | 버킷 | 용도 | 파일당 한도 | 만든 날 |
> |---|---|---|---|
> | `artifacts` | 만들어진 홈페이지 파일 ([P4-1]) | 5MB | 2026-09-11 |
> | `attachments` | 프롬프트에 붙인 파일·이미지 ([P7-8], FR-031) | 10MB | 2026-09-12 |
>
> 둘을 **나눈 이유**: 섞어두면 공개범위 규칙이 한 번 어긋날 때 사용자가 올린 원본 사진까지 함께 새어나간다.
