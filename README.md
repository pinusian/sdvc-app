# sdvc-app

**SDVC (Structured Document & Vibe Coding)** 웹서비스의 실제 애플리케이션 코드 저장소입니다.

- 방법론·문서·WBS 저장소: [`pinusian/sdvc`](https://github.com/pinusian/sdvc)
- 이 저장소: 실제로 배포되는 웹서비스 코드 (Next.js / TypeScript)

## 기술 스택 (게이트 G1, 2026-09-10 확정)

- **언어**: TypeScript 단일 (Next.js — 화면과 서버 API를 한 언어로)
- **Claude 호출**: Claude API 직접 호출 (Messages API + 커스텀 도구)
- **배포**: Vercel (GitHub 연동 자동배포)
- **DB·저장소**: Supabase (Postgres + Storage, 서울 리전)
- **결제**: Stripe

## 작업 진행 방식

이 저장소의 개발은 [`pinusian/sdvc`](https://github.com/pinusian/sdvc) 저장소의
[`10_SDVC_웹서비스/WBS_서버구축.md`](https://github.com/pinusian/sdvc/blob/main/10_SDVC_웹서비스/WBS_서버구축.md)
(WBS, 작업분해구조)를 따라 진행됩니다. 모든 커밋과 작업 단위는 WBS 작업 ID(`P#-#`)를 명시합니다.

세션 시작/재개: **"SDVC서버 구축"** · 중단: **"작업 휴식"** (진행 상황은 `pinusian/sdvc`의 `docs/progress.md`에 기록됩니다)

## 현재 상태

- [x] [P0-7] 저장소 생성 — 2026-09-10
- [ ] [P2-1] Next.js 프로젝트 뼈대 생성 (예정)
