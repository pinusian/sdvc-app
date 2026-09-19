# 최고위험 기술 검증 결과 (T012)

검증일: 2026-09-20

대상 브랜치: `codex/sdvc-openai-codex`

비용 조건: Supabase `AI-VC` Free, Vercel `SDVC` Hobby만 사용하며 유료 전환·추가 구매는 금지

## 결론

Phase 2에서 먼저 검증하기로 한 세 가지 핵심 가정은 설계를 계속 진행할 수 있는 수준으로 성립했다.

1. 사용자 OpenAI 키를 영속 작업 입력·로그·응답에 노출하지 않고 서버 측 어댑터로 중계할 수 있다.
2. 격리 실행 결과를 RED·GREEN으로 판정하고 명령·종료 코드·코드 및 테스트 해시·로그 증거를 수집할 수 있다.
3. 무료 범위에서 Supabase 프로젝트의 준비 상태와 Vercel 배포의 `Ready` 상태 및 HTTPS 결과 URL을 확인할 수 있다.

핵심 가정 실패가 없으므로 Plan 재승인은 요청하지 않는다. 다음 단계는 T013 수강생 접근 경계 RED 테스트다.

## 검증된 것

### Codex/OpenAI 키 중계 경계

- 원본 키를 영속 작업 입력, 감사 로그, 사용자 응답에 포함하지 않는 계약을 검증했다.
- 허용 범위를 벗어난 요청은 공급자 호출 전에 차단한다.
- 스트리밍, 취소, 공급자 오류 정제 계약을 검증했다.
- 관련 작업: T005~T007.

### 격리 TDD 실행과 증거 수집

- 테스트 0개와 인프라 오류를 유효한 RED로 인정하지 않는다.
- 동일 명령과 동일 테스트 해시를 사용한 실패→성공만 GREEN으로 인정한다.
- 명령, 시각, 종료 코드, 코드·테스트 해시, 로그를 증거로 수집한다.
- 네트워크와 비허용 환경변수를 차단하는 실행 포트 계약을 검증했다.
- 관련 작업: T008~T009.

### 앱 리소스 준비와 배포

- Supabase 프로젝트 상태를 `ACTIVE_HEALTHY`까지 폴링하는 계약을 검증했다.
- Vercel 배포 상태를 `READY` 또는 `ERROR`까지 폴링하고 HTTPS URL을 probe하는 계약을 검증했다.
- 멱등성 키를 고정하고 관리 토큰을 결과·로그에 남기지 않는 계약을 검증했다.
- Supabase `AI-VC FREE`의 `sdvc-codex-trial-20260919` 프로젝트가 대시보드에서 `Healthy`, Compute `NANO`임을 확인했다.
- Vercel `SDVC Hobby`가 Git commit `54d2f16`을 Preview로 자동 배포했고, 배포 `DoPNTHgvA9VuSRfW8ftmL9RMFPKZ`가 21초 만에 `Ready`가 됐다.
- Preview URL `https://sdvc-mvsvbs3yy-sdvc.vercel.app/`를 실제로 열어 HTTPS 연결과 `/login` 화면 표시를 확인했다.
- 관련 작업: T010~T011.

## 실제 실행 증거

```text
T011 전체 회귀
Test Files  89 passed (89)
Tests       894 passed (894)
Duration    117.36s
Exit code   0
```

```text
Supabase
Organization  AI-VC FREE
Project       sdvc-codex-trial-20260919
Status        Healthy
Compute       NANO
```

```text
Vercel
Team          SDVC Hobby
Commit        54d2f1633f8462a2bf16b531ec8fc0fc3cf689ae
Branch        codex/sdvc-openai-codex
Deployment    DoPNTHgvA9VuSRfW8ftmL9RMFPKZ
Environment   Preview
Status        Ready
Duration      21s
URL           https://sdvc-mvsvbs3yy-sdvc.vercel.app/login
```

## 아직 검증하지 않은 것

- 실제 OpenAI/Codex SDK 호출: 사용자 키와 API 비용 승인이 없어 호출하지 않았다.
- 프로비저닝 어댑터의 실제 관리 API 배선: 현재는 공급자 포트를 주입하는 계약 검증이며 관리 토큰을 사용한 자동 생성 호출은 하지 않았다.
- Vercel Sandbox와 Workflow 실제 연결: T034에서 구현·검증한다.
- 생성 앱의 migration, CRUD, RLS, 앱 간 데이터 격리와 실패 복구: T037~T041에서 검증한다.
- 운영 트래픽과 유료 한도 초과 동작: 비용 발생 금지 조건 때문에 시험하지 않는다.

## 설계에 남기는 안전장치

- API 키·비밀번호·관리 토큰은 채팅, Git, 작업 입력, 로그, 응답에 원문으로 남기지 않는다.
- 외부 생성 요청은 안정적인 멱등성 키를 사용한다.
- 공급자 상태가 준비 완료되기 전 다음 단계로 넘어가지 않는다.
- Vercel 결과 URL은 HTTPS 응답 확인 후에만 사용자에게 성공으로 표시한다.
- Free/Hobby 범위를 벗어나는 업그레이드·추가 구매·유료 리소스는 자동 실행하지 않는다.
- 실제 실행 흐름에 아직 연결되지 않은 어댑터는 휴면 코드 검사에 이유와 후속 작업 번호를 남긴다.

## 다음 단계

T013에서 인증되지 않은 접근, 다른 사용자 데이터 접근, 차단 사용자의 기존 세션 및 직접 API 우회를 먼저 실패 테스트로 고정한다.
