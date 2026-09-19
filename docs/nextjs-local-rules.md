# Next.js 16.3.4 로컬 규칙

작성일: 2026-09-19 · 작업: T002 · 근거: 설치된 `node_modules/next/dist/docs/`

## 읽은 문서

- `01-app/02-guides/authentication.md`
- `01-app/01-getting-started/15-route-handlers.md`
- `01-app/02-guides/server-actions.md`
- `01-app/02-guides/caching-without-cache-components.md`
- `01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md`
- `01-app/02-guides/server-and-client-boundary.md`

## 이 프로젝트에 적용할 규칙

1. 인증, 세션, 권한 부여를 분리한다. 로그인 성공만으로 데이터 접근을 허용하지 않고 각 Server Action·Route Handler·데이터 접근 함수에서 역할·소유권·차단 상태를 다시 확인한다.
2. Server Action과 Route Handler는 공개 HTTP 진입점처럼 취급한다. 화면에서 버튼을 숨기는 것은 권한 검사가 아니다.
3. 관리자용 service-role 경로는 서버 전용 모듈에 두고 일반 수강생 입력의 `userId`, `projectId`, 단계 값을 신뢰하지 않는다.
4. 사용자별·권한별 데이터는 공유 캐시에 넣지 않는다. 캐시를 적용할 때는 인증·차단 상태 변경 후 명시적으로 무효화하고 사용자 경계를 키에 포함한다.
5. API 키·관리 토큰·DB 비밀은 Server Component/Route Handler/서버 전용 모듈에만 둔다. Client Component로 넘기는 props는 직렬화되어 브라우저로 전송되므로 비밀값을 전달하지 않는다.
6. 대화·작업 진행처럼 상호작용이 필요한 최소 영역만 Client Component로 만들고, 데이터 조회와 권한 판정은 Server Component 또는 서버 모듈에 유지한다.
7. 기본 Node.js runtime을 사용한다. Next.js 16.3.4 로컬 문서에서 Edge runtime은 deprecated이므로 새 서버 경로에 `runtime='edge'`를 추가하지 않는다.
8. Server Action 입력은 서버에서 스키마 검증하고 mutation 직전에 다시 권한을 확인한다. 리다이렉트나 UI 상태를 보안 경계로 사용하지 않는다.
9. 데이터 변경 후 필요한 경로·태그만 재검증한다. 관리자 차단 상태가 캐시 때문에 지연되지 않도록 차단 판정은 요청 시점 서버 상태를 기준으로 한다.
10. 구현 전후에 Next가 생성한 타입과 로컬 문서 버전을 다시 확인한다. 학습 데이터의 과거 Next.js 관례를 우선하지 않는다.

## 현재 구성에 대한 직접 영향

- `src/app/(auth)/actions.ts`와 모든 `src/app/api/**/route.ts`는 수강생 차단 가드 적용 대상이다.
- 관리자 목록·차단 API는 `role='admin'`과 `admin_tier`를 모두 확인해야 한다.
- OpenAI 원본 키는 Client Component props, RSC payload, 스트리밍 응답, 캐시, 오류 객체에 포함하지 않는다.
- Codex·Sandbox·Workflow 연결은 Node.js 전용 서버 어댑터로 격리한다.
