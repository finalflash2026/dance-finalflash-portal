-- =========================================================
-- 0025_member_only_rosters.sql
-- SPEC.md v1.34 の差分。Google でログイン (§3.7)。
--
-- 0001〜0024 適用済みの環境に対して追加で流す。
-- =========================================================

-- Google で初めての人を受け入れるには、Supabase の新規登録を開く必要がある。
-- すると合言葉を通していない人 (プロフィールの無い人) もログインだけはできる。
-- そういう人に名簿を見せないよう、`using (true)` だった閲覧の条件を
-- 「プロフィールがある人」に締める。app_role() はプロフィールが無いと null。
-- 他のテーブルは、もともと役割・本人・所属で絞ってある。

drop policy if exists sel_profiles on public.profiles;
create policy sel_profiles on public.profiles for select to authenticated
  using (public.app_role() is not null);

drop policy if exists sel_subg on public.user_subgenres;
create policy sel_subg on public.user_subgenres for select to authenticated
  using (public.app_role() is not null);

drop policy if exists sel_subg_periods on public.user_subgenre_periods;
create policy sel_subg_periods on public.user_subgenre_periods for select to authenticated
  using (public.app_role() is not null);
