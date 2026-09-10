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
| `0001_profiles.sql` | `profiles` 테이블(역할·등급·구독상태) + RLS 정책 + 신규가입 자동생성 트리거 | 미적용 |
