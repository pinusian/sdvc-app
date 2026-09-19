# 환경변수와 비밀값 경계

작성일: 2026-09-19 · 작업: T004

## 현재 변수 분류

| 변수 | 공개 여부 | 사용 주체 | 처리 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 공개 | 브라우저·서버 | 유지 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 공개 | 브라우저·서버 | 유지, RLS 전제 |
| `SUPABASE_SECRET_KEY` | 비밀 | 서버 관리자 클라이언트 | 브라우저·생성 코드 전달 금지 |
| `ANTHROPIC_API_KEY` | 비밀 | 기존 Claude 어댑터 | OpenAI 전환 후 제거 대상 |
| `ADMIN_EMAIL` | 민감 설정 | 서버 | 관리자 자동 승격 최소화·감사 필요 |
| `STRIPE_*` | 비밀/식별자 | 서버 | 이번 핵심 흐름과 분리, 테스트 모드만 사용 |
| `CRON_SECRET` | 비밀 | 서버 예약 작업 | 다른 암호화 키와 재사용 금지 |
| `SITE_API_KEY_ENCRYPTION_SECRET` | 비밀 | 기존 방문자 키 암호화 | 수강생 OpenAI 자격 증명 키와 용도를 분리 |
| `SITE_SESSION_SECRET` | 비밀 | 기존 방문자 세션 | 수강생 Supabase Auth 및 공급자 키 암호화와 분리 |

## 신규 경계

- 수강생 OpenAI 원본 키는 HTTPS 요청에서 서버가 받은 뒤 인증 암호화해 저장한다.
- 조회 응답은 등록 여부, 마지막 몇 글자 등 마스킹 정보만 반환한다.
- 원본 키는 DB 평문, 로그, 오류 메시지, RSC props, 브라우저 저장소, 문서, 프롬프트 기록, run/workflow 영속 입력, 생성 프로젝트 파일에 저장하지 않는다.
- 암호화 마스터 키는 버전 정보를 가진 서버 전용 환경변수로 관리한다. 기존 방문자 키 암호화 비밀과 재사용하지 않는다.
- Codex 제어 서비스만 필요한 시점에 복호화하며 Sandbox의 생성 코드에는 원본 키나 Supabase/Vercel 관리 토큰을 전달하지 않는다.
- Vercel·Supabase 관리 자격은 운영자 제어 서비스에서만 사용하고 앱별 배포에는 해당 앱의 최소 자격만 제공한다.
- `.env*`, 자격 증명 이름 파일, `.sdvc/session-checkpoint`, 로그와 테스트 증거에는 비밀값 필터를 적용한다.

## 이름 확정 전 임시 표기

Phase 2 기술 검증 전에는 `.env.example`에 새 실제 변수를 성급히 추가하지 않는다. 검증 후 다음 역할의 이름을 확정한다.

- 수강생 공급자 자격 암호화 마스터 키
- Codex/OpenAI 중계 정책 및 허용 모델 설정
- Vercel/Supabase 관리 API 자격
- Workflow/Sandbox 서명·콜백 자격

어떤 경우에도 실제 값을 예제 파일, 테스트 fixture, 문서 또는 채팅에 넣지 않는다.
