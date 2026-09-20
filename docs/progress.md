# 진행 상황

> 마지막 업데이트: 2026-09-20 · 프로젝트: SDVC 웹서비스 Codex 전환 · 현재 단계: Implement Phase 4 · 세션 상태: T022 로컬 검증 완료, Preview 대기

## 1. 지금 어디까지 왔나
- 기존 저장소 복제 및 핵심 소스 읽기 완료.
- 헌장·명세·구현 가능성 조사 및 명확화 답변 반영 완료.
- plan.md와 quickstart.md 작성. 수강생 로그인·개발자 이용현황·악성 수강생 차단 조건을 반영해 계획 승인 완료.
- SDVC `작업휴식`/`SDVC 작동` 체크포인트 규칙을 스킬과 프로젝트 문서에 반영.
- 작업 분해 47개 승인 완료. 읽기 전용 Analyze에서 역할 명칭 충돌과 로컬/웹 재개 범위 혼재를 발견했고 사용자 보완 승인을 받음.
- 역할 매핑과 재개 범위를 문서에 반영하고 Phase 1 기준선 조사에 착수.
- Phase 1 T001~T004 완료: 기존 구현 감사, Next.js 16.3.4 로컬 규칙, 실제 검증 기준선, 환경변수·비밀값 경계를 문서화.
- `package-lock.json` 기준 `npm ci --ignore-scripts` 재현 설치와 Next.js 타입 생성 순서를 확인했다.
- Vitest `spawn EPERM`은 Vite가 Windows 경로 최적화를 위해 실행하는 `exec("net use")`가 Codex 샌드박스에서 차단되는 환경 문제로 분리했다. 임시 preload shim과 thread pool로 전체 기존 테스트를 실행했다.
- Phase 2 첫 버티컬 슬라이스 T005~T007 완료: 사용자 키를 영속 작업 입력·로그·응답에 노출하지 않는 서버 측 Codex 중계 계약을 RED→GREEN→REFACTOR로 구현했다.
- Phase 2 T008~T009 완료: 의미 있는 RED와 동일 테스트 묶음의 GREEN을 판정하고 명령·시각·종료 코드·해시·로그를 수집하는 격리 실행 제어 계약을 구현했다.
- Phase 2 T010 RED 완료: Supabase 프로젝트 준비, Vercel 배포 `READY`, HTTPS URL 확인과 멱등성·관리 토큰 비영속 계약을 테스트로 고정했다.
- Phase 2 T011 로컬 GREEN 완료: Supabase 준비 상태와 Vercel 배포 상태를 폴링하고 HTTPS URL을 확인하는 주입형 프로비저닝 어댑터를 구현했다. 실제 외부 생성·배포 검증은 아직 완료하지 않았다.
- 사용자가 비용 발생 금지를 조건으로 Supabase `AI-VC`, Vercel `SDVC` 사용을 승인했다. 대시보드에서 각각 Free/Hobby 범위와 현재 사용량을 확인했다.

## 2. 방금 세션에서 한 일
- pinusian/sdvc-app을 현재 작업 폴더의 sdvc-app-codex에 별도 복제.
- codex/sdvc-openai 브랜치 생성.
- 기존 코드가 Claude Messages API 직접 호출 및 정적 산출물 발행 방식임을 확인.
- 생성 코드의 자동 테스트 실행 환경이 없다는 코드상 제한을 확인.
- 사용자 확정: 개발/서비스 AI 모두 Codex/OpenAI, 자체 서버·DB 앱 생성 포함, 수강생 본인 API 키 등록.
- 원본 sdvc 진행 기록과 제품 개요를 읽어 기존 운영 구현과 이번 범위 차이 확인.
- 공식 Codex SDK, Vercel Sandbox/Workflows/배포 API, Supabase 플랫폼 통합 문서를 확인하고 계획 작성.
- 제안: 생성 스택 Next.js/TypeScript + Supabase, 앱별 Vercel/Supabase 리소스, 인프라 비용은 운영자 부담. 계획 승인 대상.
- 사용자 요청에 따라 `.sdvc/session-checkpoint/` 기반 휴식·재개 계약을 추가. 설치 스킬 SKILL.md, 진행 대본, 세션 연속성 참고문서 및 PowerShell 체크포인트 도구를 갱신.
- 사용자가 `작업휴식`을 입력해 현재 문서·Git 변경·다음 작업을 체크포인트로 저장하는 종료 절차에 진입.
- 2026-09-19 `SDVC 작동`으로 체크포인트 무결성 및 현재 파일 일치 확인.
- 사용자가 수강생 로그인, 개발자 이용현황 대시보드, 악성 수강생 차단 기능을 조건으로 Plan 승인.
- 조건을 constitution.md, spec.md, plan.md, quickstart.md에 반영하고 버티컬 슬라이스 작업 분해를 시작.
- 사용자가 47개 작업 순서를 승인함.
- Analyze 결과: 기존 `developer` DB 역할은 수강생, `admin`은 개발자/운영관리자로 고정. `.sdvc` 체크포인트는 로컬 개발용, 수강생 재접속은 DB 기반으로 분리하기로 승인함.
- 기존 관리자·계정 정지·감사 기능이 재사용 가능함을 확인하고 근거 파일을 `docs/baseline-audit.md`에 기록함.
- 번들 Node/pnpm으로 의존성을 배치하고 lint·typecheck·Vitest·Next build 기준선을 실제 실행함.
- 저장소 전용 Git 작성자를 `홍길동 <hong@example.com>`으로 설정함.
- 현재 worktree에 pnpm lockfile, `.pnpm-store`, pnpm형 `node_modules/.pnpm`이 없음을 확인하고 Node v24.19.0/npm 11.17.0으로 `npm ci --ignore-scripts`를 실행함.
- 설치된 Next.js 16.3.4 문서의 `LayoutProps` 생성 계약을 확인하고 `next typegen` 전 실패, 생성 후 성공을 재현함.
- Vite의 `net use` 호출만 우회하는 임시 preload shim으로 Vitest 전체 86개 파일/872개 테스트를 실행한 뒤 shim 파일을 제거함.
- 연결 worktree의 Git 메타데이터 쓰기 제한을 피하기 위해 `C:\Codex작업용폴더\projects\sdvc-app-codex`에 기존 Git 데이터와 최신 working tree를 보존한 독립 clone을 구성하고 `codex/sdvc-openai-codex` 브랜치에 연결함.
- 독립 clone에서 Phase 1 문서를 커밋함: `ece17e6 docs: Codex 전환 계획과 Phase 1 기준선 확정 (T001-T004)`.
- `npm run typecheck`가 `next typegen` 후 `tsc --noEmit`을 실행하도록 고정하고, Codex Windows 샌드박스용 `npm run test:codex`를 추가함.
- T005 RED 커밋 `e5b2228c479946da1c4e31a945e5ee8a9352421c`: 원본 키 비노출, 범위 초과 선차단, 스트리밍·취소·오류 정제 계약을 테스트로 고정함.
- T006 GREEN 커밋 `9e46c2ede3dd6bc7aaea313093f50e2a09afe0a0`: 키 로더와 SDK 포트를 주입받는 최소 서버 측 중계 어댑터를 구현함.
- T007 REFACTOR 커밋 `3aeb9e8f481607094ff3a1cf7e57c3182d7d8ea5`: 오류·감사 매핑을 정리하고 영속 입력·감사 로그 비노출 및 AbortError 취소 계약을 보강함.
- T008 RED 커밋 `133861d1a4810e9ad384d19cef36ed159ec8a082`: 테스트 0개·인프라 오류를 RED로 인정하지 않고 동일 명령·테스트 해시를 요구하는 계약을 작성함.
- T009 GREEN 커밋 `732ca85e4db8c887ad2f74922d51bda518af527b`: 네트워크와 환경변수를 차단한 Sandbox 포트, 단계 판정, 취소, 증거 수집 최소 구현을 작성함.
- T009 회귀 보완 커밋 `4b4d7089b4058411cfe7246ee76757bfd83b4dfc`: 실제 Workflow 배선 전 기술검증 어댑터임을 휴면 코드 안전장치에 기록하고 T034에서 제거하도록 고정함.
- T010 RED 커밋 `078be8bb0539500c81270532fcbceab401a753c1`: 공식 Management/REST API의 생성·상태 조회 분리를 반영한 앱 리소스 준비·배포 계약을 작성함.
- T011 GREEN 커밋 `bca77581fa5bc6ce84e7ec118e24407e1b09d969`: 자격 증명 참조 로더와 공급자 포트를 주입받아 Supabase `ACTIVE_HEALTHY`, Vercel `READY`, HTTPS URL probe, 오류·멱등성·토큰 비영속 계약을 구현함.
- Supabase `AI-VC` Free 조직에 프로젝트 `sdvc-codex-trial-20260919`가 생성됐다. 프로젝트 참조는 `nkxzkzzxebxwxwgrfxue`이며 대시보드에서 `STATUS Healthy`, Compute `NANO`, 프로젝트 URL의 HTTPS 제공을 확인했다. 비밀번호와 API 키는 읽거나 기록하지 않았다.
- Vercel `SDVC` 팀이 Hobby 플랜이며 현재 한도 내임을 대시보드에서 확인했다. 기존 `sdvc-app` 프로덕션 배포가 `Ready`이고 HTTPS URL에서 로그인 화면이 로드되는 것을 확인했다.
- 현재 브랜치 commit `54d2f16`의 Vercel Preview 배포가 21초 만에 `Ready`가 됐고 HTTPS `/login` 화면을 확인해 T011을 완료했다.
- T012에서 검증·미검증·안전장치와 후속 작업을 `docs/technology-validation.md`로 정리했다. 핵심 가정 실패가 없어 Plan 재승인은 필요하지 않다.
- T013에서 비로그인·타 사용자·비활성·차단·기존 세션·직접 API 우회를 매 요청 재검사하는 수강생 공통 가드 계약을 RED 테스트로 고정했다.
- T014 로컬 마이그레이션은 `is_active`, `suspended_by`, 상태 변경 시각과 감사 이전/이후 상태를 기존 스키마에 멱등 추가하며 RLS를 넓히지 않도록 작성했다.
- 사용자 승인 후 `AI-VC` Free 시험 DB에 빈 DB 의존성을 포함한 최소 체인 `0001`→`0002`→`0003`→`0004`→`0008`→`0012`를 하나의 트랜잭션으로 적용하고 실제 컬럼·정책·RLS를 확인했다.
- T015에서 인증 사용자만 보는 것으로 끝내지 않고, 매 요청마다 `profiles`의 역할·활성·차단 상태를 다시 읽는 공통 서버 가드를 구현했다.
- 첨부·결제·채팅·대화·프로젝트 변경·되돌리기·방문자 관리·신고 등 수강생 보호 Route Handler 15개에 같은 가드를 연결했다. 관리자 API·웹훅·크론·생성 앱 방문자 API는 각각의 별도 인증 경계를 유지했다.
- T018에서 수강생 현황 원천 집계와 차단 상태 전이의 도메인 계약을 추가했다. 관리자 계정 제외, 최근 활동, 프로젝트·실행·사용량, 사유 필수, 멱등 전이, 활성 작업 취소, 이전·이후 상태 감사 조건을 구현 전 실패로 고정했다.
- T019에서 관리자 전용 `/api/admin/learners` 목록·검색·상세 API와 원천 집계를 구현했다. 현재 지속 실행 테이블은 T033 범위이므로 대화 한 건을 현재 실행 단위로 보고 `current_block`을 대기·실행 중·완료 상태로 매핑했다.
- T020에서 차단·해제 사유를 필수화하고 활성/차단 상태, 수행 관리자, 상태 변경 시각을 함께 갱신한다. 중복 요청은 상태를 다시 쓰거나 작업을 재취소하지 않되 감사 기록은 남긴다.
- 진행 중 채팅 AI 호출은 사용자별 `AbortController`로 등록해 차단 시 현재 서버 인스턴스에서 즉시 취소한다. Vercel 다중 인스턴스를 가로지르는 지속 작업 취소는 T033의 run/lease 저장과 T036 경쟁 조건 회귀에서 완성한다.
- T021에서 기존 관리자 콘솔에 수강생 이용 상세를 연결하고 화면 용어를 수강생으로 정리했다. 최근 이용, 프로젝트 수, 실행 수·상태, 토큰·원가, 활성·차단 상태를 펼쳐 보고 차단과 해제 모두 사유를 입력한다.
- T022에서 수강생별 집계가 원천 배열을 반복 검색하지 않도록 프로젝트·실행·사용량을 사용자별 Map으로 한 번만 색인했다. UI도 id별 상세 Map을 메모해 반복 탐색을 제거했다.

## 3. 검증 증거
실행 명령: git ls-remote https://github.com/pinusian/sdvc-app.git HEAD
실제 출력: f361ca6be31d56016a1e0bd69c083dfebc1a75a3 HEAD
실행 명령: git rev-parse HEAD (복제 저장소)
실제 출력: f361ca6be31d56016a1e0bd69c083dfebc1a75a3
2026-09-19 기준선 검증:
- `node_modules/.bin/eslint.CMD .` → 종료 코드 0, 출력 없음.
- `node_modules/.bin/tsc.CMD --noEmit` → 종료 코드 1, `src/app/layout.tsx(22,50): error TS2304: Cannot find name 'LayoutProps'.`
- `node_modules/.bin/vitest.CMD run` → 종료 코드 1, 테스트 수집 전 `spawn EPERM`.
- `node_modules/.bin/vitest.CMD run --configLoader runner` → 종료 코드 1, `ReferenceError: require is not defined`.
- `node_modules/.bin/vitest.CMD run --configLoader native` → 설정 로딩·탐색 후 worker 생성이 `spawn EPERM`으로 중단, 86개 worker 오류, 실행된 테스트 없음.
- `node_modules/.bin/next.CMD build` → 컴파일 성공 후 TypeScript 단계 `spawn EPERM`, 종료 코드 1.
- 브라우저 E2E와 실제 외부 공급자 연결은 아직 실행하지 않음.
2026-09-19 npm/타입/Vitest 분리 검증:
- `npm ci --ignore-scripts` → 종료 코드 0, `added 459 packages`, `found 0 vulnerabilities`.
- pnpm 산출물 검사 → 루트 pnpm 항목 없음, `node_modules/.pnpm` 없음.
- `tsc --noEmit` (typegen 전) → 종료 코드 2, `Cannot find name 'LayoutProps'` 재현.
- `next typegen` → 종료 코드 0, `Types generated successfully`.
- `tsc --noEmit` (typegen 후) → 종료 코드 0, 출력 없음.
- `vitest run` (우회 없음) → 종료 코드 1, Vite `optimizeSafeRealPathSync`의 `exec("net use")`에서 `spawn EPERM`.
- 임시 preload shim + `vitest run --pool=threads --maxWorkers=4 --reporter=dot` → 종료 코드 0, `86 passed`, `872 passed`, 96.92초. 테스트가 의도적으로 기록한 stderr 3건 외 실패 없음.
- 독립 clone `npm ci --ignore-scripts` → 종료 코드 0, `added 459 packages`, `found 0 vulnerabilities`.
- `npm run typecheck` → 종료 코드 0, `Types generated successfully`, TypeScript 오류 없음.
- `npm run lint` → 종료 코드 0, 출력 오류 없음.
- ESM shim 최종본 `npm run test:codex -- --reporter=dot` → 종료 코드 0, `86 passed`, `872 passed`, 105.87초.
- T005 RED `npm run test:codex -- tests/lib/openai/codex-relay.test.ts --reporter=verbose` → 종료 코드 1, 테스트 수집 성공 후 `1 file`, `6 failed`, 2.65초. 모든 실패가 미구현 중계 경계의 의도된 오류였음.
- T006 GREEN 동일 대상 테스트 → 종료 코드 0, `1 file`, `6 passed`; `npm run typecheck`와 `npm run lint`도 종료 코드 0.
- T007 REFACTOR 동일 대상 테스트 → 종료 코드 0, `1 file`, `8 passed`, 4.41초; `npm run typecheck`와 `npm run lint`도 종료 코드 0.
- T007 전체 회귀 `npm run test:codex -- --reporter=dot` → 종료 코드 0, `87 files passed`, `880 tests passed`, 110.55초.
- T008 RED 대상 테스트 → 종료 코드 1, 테스트 수집 성공 후 `1 file`, `7 failed`, 2.64초. 모든 실패가 `T008 Sandbox execution contract is not implemented`였음.
- T009 GREEN 대상 테스트 → 종료 코드 0, `1 file`, `7 passed`, 2.51초; typecheck와 lint도 종료 코드 0.
- 최초 T009 전체 회귀 → 종료 코드 1, `87 passed / 1 failed`; 기존 휴면 코드 검사에서 실제 실행 흐름 미배선을 정확히 탐지함.
- 휴면 경계 기록 후 대상 회귀 → 종료 코드 0, `2 files`, `10 tests passed`, 4.24초; typecheck와 lint도 종료 코드 0.
- T009 최종 전체 회귀 → 종료 코드 0, `88 files passed`, `887 tests passed`, 122.79초.
- T010 RED 대상 테스트 → 종료 코드 1, 테스트 수집 성공 후 `1 file`, `6 failed / 1 passed`, 2.95초. 실패 6건은 모두 `T010 application provisioning contract is not implemented`였음.
- T011 GREEN 대상 테스트 → 종료 코드 0, `1 file`, `7 passed`, 35.05초.
- T011 GREEN과 휴면 경계 회귀 → 종료 코드 0, `2 files`, `10 tests passed`, 8.25초.
- T011 구현 후 `npm run typecheck` → 종료 코드 0, `Types generated successfully`; `npm run lint` → 종료 코드 0, 오류 출력 없음.
- T011 전체 회귀 `node --import ./scripts/vitest-windows-sandbox-shim.mjs ./node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=4 --reporter=dot` → 종료 코드 0, `89 files passed`, `894 tests passed`, 117.36초. 기존 예외 응답 검증이 의도적으로 기록한 stderr 3건 외 실패 없음.
- Supabase 대시보드 확인 → `AI-VC FREE`, 프로젝트 `sdvc-codex-trial-20260919`, 참조 `nkxzkzzxebxwxwgrfxue`, `STATUS Healthy`, Compute `NANO`, HTTPS 프로젝트 URL 확인.
- Vercel 대시보드 확인 → `SDVC Hobby`, 기존 배포 `FsH3KtPfXuNcpBfyGX7H8trTQoSD`, `Ready`, Production, 배포 시간 21초. `https://sdvc-31xnpo8el-sdvc.vercel.app/` 접속은 HTTPS로 성공했고 `/login` 화면을 표시함.
- `git push -u origin codex/sdvc-openai-codex` → 종료 코드 1, 샌드박스 프록시 `127.0.0.1`을 통한 GitHub 443 연결 실패. 원격 인증 거부가 아니라 현재 실행 환경의 네트워크 연결 실패임.
- 사용자 터미널에서 push 완료 후 Vercel 자동 Preview 확인 → commit `54d2f16`, branch `codex/sdvc-openai-codex`, deployment `DoPNTHgvA9VuSRfW8ftmL9RMFPKZ`, `Ready`, 21초.
- Preview URL `https://sdvc-mvsvbs3yy-sdvc.vercel.app/` 접속 → HTTPS 성공, `/login`으로 이동하고 SDVC 로그인 화면 표시.
- T013 RED 대상 테스트 → 종료 코드 1, `1 file`, `8 failed`, 1.72초. 8건 모두 `T013 learner access guard is not implemented`로 의미 있게 실패함.
- T013 타입 검사 → 종료 코드 0, `Types generated successfully`; 대상 lint → 종료 코드 0.
- T014 마이그레이션 계약 테스트 → 종료 코드 0, `1 file`, `4 passed`, 1.81초; 이후 전체 typecheck도 종료 코드 0.
- Supabase SQL Editor 트랜잭션 실행 → 오류 없이 결과 표 반환. 검증 쿼리 `15 rows`: T014 컬럼 9개, `profiles_select_own` 정책 1개, `profiles`·`conversations`·`messages`·`projects`·`admin_audit_logs` RLS 활성 5개.
- T015 대상 검증 → 수강생 순수 가드, Next.js 어댑터, 보호 API 배선, 채팅·대화 회귀 `4 files`, `89 tests passed`; `npm run typecheck`와 `npm run lint -- --quiet` 종료 코드 0.
- T015 전체 회귀 `npm run test:codex -- --reporter=dot` → 종료 코드 0, `92 files passed`, `924 tests passed`, 88.45초. 의도된 예외 응답 검증 stderr 3건 외 실패 없음.
- T016 UI GREEN → 보호 Server Component 공통 가드, 본인 전용 계정 제한 안내, 로그인 문구 및 로그아웃 경로를 연결했다. 비로그인/정지 분기와 사유 비노출 조건 대상 검증 `2 files`, `9 tests passed`.
- T016 정적·전체 회귀 → `npm run typecheck`, `npm run lint` 종료 코드 0; `npm run test:codex -- --reporter=dot` 종료 코드 0, `94 files passed`, `933 tests passed`, 97.87초. 의도된 예외 응답 검증 stderr 3건 외 실패 없음.
- T016 프로덕션 빌드 → 애플리케이션 컴파일 전 `next/font`가 Google Fonts(Fraunces, Noto Sans KR)를 현재 제한 네트워크에서 가져오지 못해 종료 코드 1. 타입·lint·테스트 실패와는 분리했으며 T017 브라우저 회귀와 함께 재확인한다.
- T017 REFACTOR → 최신 프로필 조회를 `loadLearnerProfile` 단일 경로로 통합하고, 페이지 가드는 HTTP 응답 객체 대신 명시적인 거부 코드로 분기하도록 정리했다. 커밋 `c40d7d0`.
- T017 대상 회귀 → 수강생 순수·Route Handler·페이지 가드와 제한 안내 `4 files`, `36 tests passed`; typecheck와 lint 종료 코드 0.
- T017 전체 회귀 → `npm run test:codex -- --reporter=dot` 종료 코드 0, `94 files passed`, `934 tests passed`, 136.58초. 브라우저 시나리오 2개는 Playwright 수집에 성공했으나 이 샌드박스의 브라우저 프로세스 생성이 `spawn EPERM`으로 차단됐다.
- Vercel `SDVC` Hobby 배포 목록 확인 → 최신 Preview는 여전히 commit `54d2f16`이다. T016/T017 커밋을 원격에 push한 뒤 새 무료 Preview에서 브라우저 회귀를 실행해야 한다.
- 사용자 push 후 Vercel `SDVC` Hobby Preview `FbUBjhURj7ng5YELp2Vq28Vy7cCh`가 commit `7f411d0`으로 28초 만에 `Ready`가 됐다. Preview URL은 `https://sdvc-jrrudhyxa-sdvc.vercel.app/`이다.
- T017 실제 브라우저 회귀 → 비로그인 상태에서 `/dashboard`, `/conversations/not-a-real-id`, `/account-restricted`를 각각 직접 열었고, 세 경로 모두 `/login`으로 이동해 “수강생 로그인” 제목과 로그인 폼을 표시했다. 브라우저 error 로그는 0건이었다.
- T018 RED 대상 테스트 → 종료 코드 1, `2 files`, `8 failed / 17 passed`, 2.36초. 집계·상태 전이 미구현 6건과 차단·해제 사유 검증 누락 2건이 의미 있게 실패했고, 일반 수강생의 관리자 GET/POST 거부를 포함한 기존 방어는 통과했다.
- T018 정적 검사 → `npm run typecheck` 종료 코드 0. 미사용 인자 경고를 정리한 뒤 대상 lint도 종료 코드 0, 경고·오류 없음.
- T019 최종 대상 검증 → `2 files`, `7 passed / 4 skipped`, 2.76초. T018 집계 RED 2건까지 GREEN이 됐고, 건너뛴 4건은 T020에서 구현할 차단 상태 전이 계약이다.
- T019 정적 검사 → `npm run typecheck`와 관련 4개 파일 대상 lint 모두 종료 코드 0.
- T020 대상 회귀 → 관리자 상태 전이·권한·감사·활성 작업·채팅 스트림 관련 `8 files`, `131 passed`, 9.70초. 의도된 예외 응답 검증 stderr 3건 외 실패 없음.
- T020 정적 검사 → `npm run typecheck`와 관련 14개 파일 대상 lint 모두 종료 코드 0.
- T020 전체 회귀 → `97 files passed`, `951 tests passed`, 112.86초. 의도된 예외 응답 검증 stderr 3건 외 실패 없음.
- T021 UI 대상 검증 → `1 file`, `21 passed`, 5.74초. 사유 입력 시 action이 유실되던 중간 실패 2건을 수정한 뒤 통과했다.
- T021 정적·전체 회귀 → `npm run typecheck`와 대상 lint 종료 코드 0; 전체 `97 files passed`, `952 tests passed`, 109.47초. 의도된 예외 응답 검증 stderr 3건 외 실패 없음.
- T022 대상 회귀 → 권한·집계·관리 API·UI `4 files`, `51 passed`, 7.51초. Playwright `e2e/admin-entry.spec.ts --list`는 `7 tests in 1 file`을 수집했다.
- T022 정적·전체 회귀 → `npm run typecheck`와 대상 lint 종료 코드 0; 전체 `97 files passed`, `952 tests passed`, 108.73초. 의도된 예외 응답 검증 stderr 3건 외 실패 없음.
- T022 push 시도 → 종료 코드 1, Git for Windows `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`. 네트워크 권한은 허용됐으나 이 실행 환경에 GitHub 자격 증명이 없어 원격 변경은 발생하지 않았다.
문서 검사: git diff --cached --check에서 오류 출력 없음.
독립 clone의 저장소 전용 작성자 `홍길동 <hong@example.com>`으로 Phase 1과 T005~T007 커밋을 완료함.
SDVC 체크포인트 스크립트 시험(격리된 임시 Git 저장소):
- PowerShell 구문 검사: `POWERSHELL_PARSE_OK`
- 저장 후 재검사: `CHECKPOINT_OK files=2`
- 사본 변조 탐지: `EXPECTED_TAMPER_DETECTED 해시 불일치: src/example.ts`
- `.env` 및 credential 이름 파일의 사본·patch 제외: `SECRET_EXCLUSION_OK`, `PATCH_SECRET_EXCLUSION_OK`
- 스킬 구조와 참조 파일 검사: `SKILL_STRUCTURE_OK`, `CHECKPOINT_SCRIPT_PARSE_OK`
- skill-creator의 quick_validate.py는 번들 Python에 PyYAML이 없어 실행되지 않음(`ModuleNotFoundError: yaml`). 동일 구조 조건은 PowerShell로 검사함.
- 실제 프로젝트 체크포인트 저장·재검사: `CHECKPOINT_OK files=6` (Save 직후와 Inspect에서 각각 확인).
- 체크포인트 위치: `.sdvc/session-checkpoint/`; 브랜치 `codex/sdvc-openai`; 기준 HEAD `f361ca6be31d56016a1e0bd69c083dfebc1a75a3`.
- `git diff --cached --check`: 오류 출력 없음.
- Git 작성자 확인: `GIT_IDENTITY_MISSING`. 임의 신원 설정 없이 커밋을 건너뜀; 체크포인트 저장은 성공.

## 4. 다음 할 일
- [x] plan.md에 대한 명시적 사용자 승인을 확인하고 조건을 관련 문서에 반영한다.
- [x] `SDVC 작동`에서 체크포인트 무결성과 현재 파일 차이를 검사한다.
- [x] 독립 clone에서 현재 문서를 검증·커밋한다. 작성자는 `홍길동 <hong@example.com>`으로 설정됨.
- [x] SDVC references/04-tdd-vertical-slice.md를 읽고 tasks.md를 작성한다.
- [x] tasks.md의 완료 기준·RED/GREEN/REFACTOR 커밋 및 기술 검증 순서에 대한 승인을 받는다.
- [x] 읽기 전용 Analyze를 수행하고 발견된 역할·재개 범위 문제의 보완 승인을 받는다.
- [x] T001 기존 구현 재사용/교체 경계를 기록한다.
- [x] T002 Next.js 16.3.4 로컬 규칙을 기록한다.
- [x] T003 테스트·lint·typecheck·build 기준선을 실행하고 기록한다.
- [x] T004 환경변수와 비밀값 경계를 기록한다.
- [x] 임시 pnpm 산출물 부재를 확인하고 npm 기반 설치 재현 경로를 확정한다.
- [x] `LayoutProps` 타입 오류와 Vitest `spawn EPERM` 환경 오류를 Phase 2 기능 RED 전에 분리 진단·검증한다.
- [x] T005 OpenAI 사용자 키 중계와 Codex SDK 호출 계약의 RED 테스트를 작성한다.
- [x] T006 서버 측 OpenAI/Codex 어댑터 최소 구현으로 계약 테스트를 통과시킨다.
- [x] T007 키 중계와 공급자 오류 매핑을 정리하고 전체 회귀검사를 통과시킨다.
- [x] T008 Sandbox에서 샘플 저장소의 의미 있는 실패·성공 테스트 실행 계약을 RED로 작성한다.
- [x] T009 실행 제어 어댑터와 증거 수집 최소 구현을 작성하고 전체 회귀검사를 통과시킨다.
- [x] T010 시험 Supabase/Vercel 어댑터의 리소스 준비·배포·READY·URL 확인 계약을 RED로 작성한다.
- [x] T011 실제 시험 리소스의 비용·계정 범위를 승인받는다: 비용 발생 금지, Supabase `AI-VC`, Vercel `SDVC`.
- [x] T011 로컬 프로비저닝 어댑터를 구현하고 대상·전체 회귀검사를 통과시킨다.
- [x] Supabase `AI-VC` Free 프로젝트 `sdvc-codex-trial-20260919`의 생성과 `Healthy` 상태, HTTPS 프로젝트 URL을 확인한다.
- [x] Vercel `SDVC` Hobby의 기존 프로덕션 배포가 `Ready`이고 HTTPS URL에서 앱 화면이 로드되는 것을 확인한다.
- [x] 현재 `codex/sdvc-openai-codex` 브랜치를 GitHub에 push한 뒤 이 브랜치의 Vercel 시험 배포 `Ready`·HTTPS URL을 확인한다.
- [x] T012 최고위험 기술 검증 결과를 검증/미검증/안전장치로 구분해 기록한다.
- [x] T013 인증되지 않은 접근, 타 사용자 접근, 차단 사용자 기존 세션·직접 API 우회 RED 테스트를 작성한다.
- [x] T014 로컬 계정 제한 마이그레이션을 `AI-VC` 시험 DB에 적용하고 컬럼·RLS 상태를 검증한다.
- [x] T015 모든 보호 API와 작업 시작·재개에 공통 서버 가드를 적용하고 T013 RED 테스트를 GREEN으로 만든다.
- [x] T016 로그인·로그아웃·차단 안내 화면을 공통 가드와 연결하고 차단 사유 노출 범위를 검증한다.
- [x] T017의 로컬 커밋 `0bc7a68`~`7f411d0`을 원격 브랜치에 push한다.
- [x] Vercel `SDVC` Hobby 새 Preview에서 비로그인 보호 화면 리디렉션과 로그인 화면을 실제 브라우저로 검증하고 T017을 완료 처리한다.
- [x] T018 일반 수강생의 관리자 접근 거부, 현황 집계 정확성, 차단·해제·감사 기록 RED 테스트를 작성한다.
- [x] T019 관리자 전용 수강생 목록·검색·상세·집계 API를 구현해 T018 집계 RED를 GREEN으로 만든다.
- [x] T020 사유 필수 차단·해제, 멱등 상태 전이, 감사 기록과 활성 작업 취소 계약을 GREEN으로 만든다.
- [x] T021 개발자 대시보드와 수강생 상세·차단·해제 화면을 구현한다.
- [ ] 로컬 커밋 `57187a5`~`d289a85`를 `codex/sdvc-openai-codex` 원격 브랜치에 push한다.
- [ ] T022 Vercel `SDVC` Hobby Preview에서 비로그인 `/admin`의 관리자 로그인 표시와 수강생 정보 비노출을 확인한다.

## 5. 막힌 것 / 사용자 결정 대기
- Plan·Tasks·Analyze 보완 승인은 완료됐다. 외부 리소스 범위도 Supabase `AI-VC` Free와 Vercel `SDVC` Hobby로 승인됐다.
- 연결 worktree의 Git 쓰기 제한은 독립 clone 전환으로 우회했고 T011 GREEN 커밋까지 검증했다.
- 사용자 결정 대기 없음. T014 시험 DB 적용 승인을 받아 완료했다.
- 비용이 발생하는 업그레이드·추가 구매·유료 리소스는 실행하지 않는다. 무료 범위를 벗어나는 징후가 보이면 즉시 중단한다.
- Codex 키 중계의 주입형 계약과 비밀값 경계는 검증했다. 실제 외부 Codex SDK/API 호출은 사용자 키·비용 승인 없이 수행하지 않았으므로 아직 미검증이다.
- Sandbox 격리 실행·증거 수집의 주입형 제어 계약은 검증했다. 실제 Vercel Sandbox 연결과 Workflow 배선은 T034 전까지 미검증이다.
- API 비밀키는 채팅으로 받거나 파일에 임의로 채우지 않는다.
- 현재 실행 환경의 GitHub 자격 증명이 없어 T022 push가 `SEC_E_NO_CREDENTIALS`로 중단됐다. 사용자의 인증된 터미널에서 push가 필요하다.

## 6. 알아둘 함정
- 상위 AI_Code_Study/docs/progress.md는 독서활동 프로젝트 기록이며 이번 프로젝트 기록이 아니다.
- git과 rg가 기본 PATH에 없다. Git은 C:/Program Files/Git/cmd/git.exe로 호출했다.
- 웹 도구의 GitHub 조회는 실패했으나 승인된 Git 네트워크 접근으로 복제에 성공했다.
- 기존 README의 체크리스트는 실제 소스 구현량을 반영하지 못한다.
- 기존 tests.html 안내를 실제 서버 TDD 증거로 취급하지 않는다.
- AGENTS.md에 따라 구현 전 설치된 Next.js 버전의 로컬 문서를 읽어야 한다.
- `.sdvc/session-checkpoint/`는 로컬 세션 인계용이며 Git에 커밋하지 않는다. 현재 파일이 더 최신이면 체크포인트로 자동 덮어쓰지 않는다.
- 임시 pnpm 설치는 build script 승인 제한으로 종료 코드 1이었다. `package-lock.json` 기반 npm 설치를 정본으로 삼고 pnpm 생성 파일을 커밋하지 않는다.
- 기준선: ESLint 성공, TypeScript `LayoutProps` 오류 1건, Vitest 시작 환경 오류, Next 컴파일 성공 후 타입 검사 프로세스 `spawn EPERM` 실패.
- Next.js의 전역 `LayoutProps`는 `next typegen`이 먼저 생성해야 깨끗한 checkout의 단독 `tsc`가 통과한다.
- 이 Codex 샌드박스에서는 Vite의 Windows `net use` 자식 프로세스만 임시로 우회해야 Vitest가 시작된다. 제품 코드 오류로 오인하거나 영구적으로 `node_modules`를 수정하지 않는다.
- 현재 셸 PATH에는 Node/npm도 없을 수 있다. 검증에는 `C:\Program Files\nodejs\node.exe` 절대 경로를 사용했으며 PATH 실패를 기능 RED로 취급하지 않는다.
