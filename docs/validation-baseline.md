# 검증 기준선

작성일: 2026-09-19 · 작업: T003

## 실행 환경

- 프로젝트에 `node_modules`가 없어 번들 Node.js와 pnpm 11.19.0으로 의존성을 설치했다.
- 설치 명령: `pnpm install --lockfile=false`
- 설치 결과: 패키지 448개가 배치됐으나 `unrs-resolver@1.12.2` build script가 허용되지 않아 설치 프로세스 종료 코드는 1이었다. 의존성 파일은 생성됐지만 이 상태를 정상 설치 완료로 간주하지 않는다.
- 원래 저장소는 `package-lock.json`과 npm 실행 절차를 사용한다. 이번 pnpm 파일은 임시 기준선 실행에서 생성된 것이며 정본으로 채택하지 않는다.

## 실제 실행 결과

### ESLint

명령: `node_modules/.bin/eslint.CMD .`

결과: 종료 코드 0, 출력 없음.

### TypeScript

명령: `node_modules/.bin/tsc.CMD --noEmit`

결과: 종료 코드 1.

```text
src/app/layout.tsx(22,50): error TS2304: Cannot find name 'LayoutProps'.
```

### Vitest

명령: `node_modules/.bin/vitest.CMD run`

결과: 종료 코드 1. 테스트 수집 전 Vite config 로딩에서 `spawn EPERM`이 발생했다.

대체 명령: `node_modules/.bin/vitest.CMD run --configLoader runner`

결과: 종료 코드 1. CommonJS 의존성 로딩에서 `ReferenceError: require is not defined`가 발생했다.

추가 대체 명령: `node_modules/.bin/vitest.CMD run --configLoader native`

결과: 종료 코드 1. 설정 로딩과 테스트 탐색까지는 진행했으나 worker pool 생성이 모두 `spawn EPERM`으로 중단되었다. 86개의 미처리 worker 오류가 보고되었고 테스트 파일과 테스트는 실행되지 않았다.

따라서 테스트가 실패한 것이 아니라 테스트 러너가 시작되지 못했다. 통과한 테스트 수는 0으로 주장하지 않으며, 테스트 결과는 **미검증**이다.

### Next.js build

명령: `node_modules/.bin/next.CMD build`

결과: 종료 코드 1.

```text
▲ Next.js 16.3.4 (Turbopack)
✓ Running next.config.ts took 154ms
Creating an optimized production build ...
✓ Compiled successfully in 34.3s
Running TypeScript ...
spawn EPERM
```

번들 컴파일은 성공했지만 타입 검사 보조 프로세스 생성 단계에서 실패했으므로 전체 빌드 성공으로 간주하지 않는다. 직접 TypeScript 실행에서 별도의 `LayoutProps` 오류도 확인됐다.

## 기준선 판정

- lint: 확인됨(성공)
- typecheck: 확인됨(코드 오류 1건)
- unit/API/component tests: 러너 환경 오류로 미검증
- production build: 컴파일 성공, 전체 빌드는 미검증/실패
- browser E2E: 환경 변수와 서버가 없어 이번 기준선에서 실행하지 않음

Phase 2 전 준비 작업으로 npm 기반 의존성 설치 재현, `LayoutProps` 오류 해결, Vitest의 Windows `spawn EPERM` 원인 분리를 수행한다. 해당 수정은 기존 결함 수리이며 기능 RED 테스트와 섞지 않는다.
