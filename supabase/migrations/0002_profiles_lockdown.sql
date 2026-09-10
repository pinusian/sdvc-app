-- [P2-7] 보안 수정: profiles 자기수정 정책 제거
--
-- 0001에서 만든 "profiles_update_own" 정책은 컬럼 단위 제한이 없어서,
-- 일반 개발자가 자기 프로필의 role 컬럼을 'admin'으로 직접 바꿔
-- 스스로 관리자 권한을 얻을 수 있는 허점이 있었다.
--
-- 지금부터 profiles는 클라이언트에서 읽기만 가능하고(select), 쓰기는
-- 전부 서버의 SUPABASE_SECRET_KEY 관리자 클라이언트를 통해서만 한다
-- (RLS를 완전히 우회하므로 이 정책과 무관하게 항상 가능).

drop policy if exists "profiles_update_own" on public.profiles;
