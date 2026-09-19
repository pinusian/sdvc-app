# 기존 구현 기준선 감사

작성일: 2026-09-19 · 작업: T001

## 결론

기존 저장소는 빈 프로젝트가 아니다. 수강생 인증, 프로젝트 소유권, 관리자 권한, 계정 정지, 감사 로그, 사용량, 산출물 공개, 방문자 계정의 상당 부분이 구현돼 있다. 이번 전환은 이를 보존하면서 Anthropic 중심 대화·정적 산출물 구조를 OpenAI/Codex 실행·문서 버전 승인·실제 TDD·앱별 DB/배포 구조로 확장하는 작업이다.

## 역할 매핑

| 제품 용어 | 기존 구현 | 처리 |
|---|---|---|
| 수강생 | `profiles.role='developer'` | DB 값과 기존 권한 코드를 유지하고 새 UI 표시는 수강생으로 통일 |
| 개발자/운영관리자 | `profiles.role='admin'`, `admin_tier` | 기존 관리자 관문과 감사 로그를 재사용·강화 |

## 재사용 후보와 근거

| 영역 | 근거 파일 | 관찰 | 판단 |
|---|---|---|---|
| 수강생 가입·로그인 | `src/app/(auth)`, `src/lib/auth/*` | Supabase Auth 기반 화면과 서버 로직 존재 | 재사용 후 차단 가드 보강 |
| 프로필·역할 | `supabase/migrations/0001_profiles.sql` | `admin`/`developer` 역할과 RLS 존재 | 기존 `developer`를 수강생으로 유지 |
| 관리자 권한 | `src/lib/admin/access.ts`, `src/lib/admin/guard.ts` | super/operator/support 등급별 권한과 deny-by-default 판정 | 재사용, 수강생 현황 필드 추가 |
| 계정 정지 | `0008_admin_operations.sql`, `src/lib/admin/developers.ts` | `suspended_at/reason`, 정지·해제 API 존재 | 재사용하되 기존 세션·모든 보호 API·장시간 작업 차단을 검증 |
| 관리자 화면 | `src/app/admin`, `src/components/admin/AdminConsole.tsx` | 개발자 목록·프로젝트·사용량·감사 화면 존재 | 용어를 수강생으로 바꾸고 새 집계·상세를 추가 |
| 감사 로그 | `admin_audit_logs`, `src/lib/admin/audit.ts` | 관리자 열람·변경과 거부 시도 기록 | 이전/이후 상태와 차단 사유를 강화 |
| 계정별 한도 | `0009_education_operations.sql` | 등급 부여와 월 토큰 한도 존재 | OpenAI 사용량·동시 실행 한도에 연결 |
| 프로젝트 소유권 | `src/lib/projects/access.ts`, `store.ts` | 사용자별 프로젝트 경계 존재 | 문서·실행·배포에도 동일 경계 적용 |
| 공개 산출물 | `src/lib/artifacts/*`, `/site/[slug]` | 저장 파일을 URL로 제공 | 실제 테스트·배포·URL 확인 후 publish로 교체 |
| 방문자 기능 | `src/lib/site-accounts/*`, `/api/site/*` | 별도 방문자 인증·레코드·API 키 구조 존재 | 생성 앱 참조 시나리오의 아이디어만 재사용; 플랫폼 공통 DB로 완료 판정 금지 |

## 교체 또는 신규 구현

- `src/lib/claude/chat.ts`와 Anthropic 메시지 계약을 OpenAI 대화 어댑터 및 Codex 작업 어댑터로 교체한다.
- `.env.example`의 `ANTHROPIC_API_KEY` 및 방문자 Anthropic 키 설명은 새 자격 증명 모델과 구분해 단계적으로 제거·이관한다.
- 문서 버전·해시·승인, runs/run_events/test_evidence, deployments/project_resources 데이터가 필요하다.
- 기존 `deployed` 상태는 실제 테스트·빌드·READY·URL 인수 검사를 통과한 `published` 의미로 강화한다.
- 장시간 작업, 취소, 재시도, 멱등성, lease 및 차단 중단 처리는 신규 구현이다.
- 생성 앱은 관리 플랫폼과 다른 origin 및 앱별 DB/배포 경계를 사용해야 한다.

## 확인된 기존 결함·주의점

- `src/app/layout.tsx`가 전역 타입으로 생성되는 `LayoutProps<"/">`에 의존하지만 현재 직접 `tsc --noEmit`에서 해당 타입을 찾지 못한다.
- 기존 마이그레이션 주석의 “개발자”는 현재 제품 용어의 수강생을 뜻한다. 새 코드에서 자연어와 DB 역할을 혼용하지 않는다.
- 기존 관리자 정지는 로그인 자체를 막지 않고 로그인 후 기능을 차단하는 정책이다. 수강생에게 정지 사유·문의 경로를 보여줄 수 있으므로 유지하되, 보호 API와 작업 재개 우회가 없는지 새 인수 테스트로 검증한다.
- README의 완료 체크리스트는 코드와 운영 검증 전체를 증명하지 않는다.
