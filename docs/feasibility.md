# 구현 가능성 및 기존 코드 조사

조사일: 2026-09-18
기준 저장소: https://github.com/pinusian/sdvc-app
기준 커밋: f361ca6be31d56016a1e0bd69c083dfebc1a75a3

## 판단

요구한 서비스는 구현 가능하다. 기존 Next.js·Supabase 코드에는 인증, 대화, SDVC 블록, 산출물 저장·URL 서비스가 있어 재사용 후보가 된다. 다만 모델 API 교체만으로 실제 TDD 실행 조건이 충족되지는 않는다. 실행 환경과 증거 저장·검증 후 발행 기능을 추가해야 한다.

## 직접 확인한 사항

| 근거 파일 | 관찰 | 영향 |
|---|---|---|
| package.json | Next.js 16.3.4, React, Supabase, Vitest, Playwright | 기존 기술 기반 재사용 검토 |
| src/lib/claude/chat.ts | Anthropic Messages API를 fetch로 직접 호출 | Claude Code 런타임을 서버에서 실행하는 구조는 아님 |
| src/lib/sdvc/blocks.ts | SDVC 단계 및 승인 안내 존재. NO_EXECUTION_LINES로 코드 실행 불가 명시 | 실제 RED/GREEN 자동 실행 추가 필요 |
| src/app/api/chat/route.ts | DB 단계 조회, 승인 입력, 메시지 스트리밍 및 산출물 발행 호출 | 문서 버전별 승인·작업 실행·발행 조건 보강 검토 |
| src/lib/artifacts/publish.ts | 생성 파일 업로드 후 deployed 상태 저장 | 실제 테스트·URL 확인과 배포 상태 연결 필요 |
| src/app/site/[slug]/[[...path]]/route.ts | Storage 파일을 고유 URL 경로로 제공 | URL 기능 재사용 후보. 생성 코드와 관리 화면의 origin 격리 검토 |
| supabase/migrations | 계정·대화·프로젝트·사용량 등 마이그레이션 존재 | 기존 데이터와 새 문서·실행 기록의 호환 계획 필요 |

README의 현재 상태 목록만으로 구현 범위를 판단하지 않았다. 소스가 더 많은 기능을 포함한다. 위는 정적 조사이며 실행 검증 결과가 아니다.

## Codex 적용 후보

공식 Codex SDK 문서는 서버 측에서 Codex 세션 시작·재개와 애플리케이션 통합을 지원한다고 설명한다.
- https://developers.openai.com/codex/sdk
- https://developers.openai.com/codex/auth

설계 후보는 웹 UI·서비스 API(Vercel), 인증·영속 저장(Supabase), 격리된 비동기 코드 실행 환경(Codex SDK 및 테스트 실행)이다. 실행 제공자·한도·비용은 Plan에서 공식 문서와 함께 비교·확정해야 한다. Vercel 일반 요청 안에서 장시간 코드 생성을 모두 처리한다고 가정하지 않는다.

서비스 로그인과 AI 실행 인증은 구분한다. “설치 없음”은 수강생 경험의 조건이며 서버에는 SDK와 실행 도구가 필요하다. 후속 사용자 답변으로 수강생 본인 OpenAI API 키 등록 및 자체 서버·DB 앱 생성이 확정됐다. ChatGPT 구독이 서비스 API 비용을 대신한다고 가정하지 않는다. 구체적인 설계와 실증이 필요한 항목은 plan.md에 기록했다.

## 이번 조사에서 하지 않은 것

코드 변경, 의존성 설치, 테스트 실행, 실제 AI 호출, DB 마이그레이션, 원격 푸시, 배포는 수행하지 않았다. 명확화 답변을 반영해 계획까지 작성했으며, 계획과 작업 분해를 차례로 검토·승인받는다.
