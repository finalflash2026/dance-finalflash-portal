-- =========================================================
-- 0024_studio_subgenres_and_attendance_reason.sql
-- SPEC.md v1.33 の差分。
--
-- 0001〜0023 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- スタ練は 2/3ジャンでも立てられる (§6.3.1) ----------
-- 2ジャン・3ジャンにも練習 (ジャンルショーケースの練習など) があり、
-- そのジャンルの誰かが立てられないと困る。他ジャンルは今までどおり不可。
-- 「今の」2/3ジャンで判定する (立てるのは今日以降の予定のため)。
create or replace function public.has_genre_now(p_genre smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_genre = public.app_main_genre()
      or exists (select 1 from public.user_subgenres
                 where user_id = auth.uid() and genre_id = p_genre)
$$;

drop policy if exists ins_gpractice on public.genre_practices;
create policy ins_gpractice on public.genre_practices for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_genre_now(genre_id)
    and public.app_role() <> 'ob'
  );

-- 直せるのは登録した本人だけ (v1.22 と同じ)。ジャンルは自分のジャンルの中でだけ
drop policy if exists upd_gpractice on public.genre_practices;
create policy upd_gpractice on public.genre_practices for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and public.has_genre_now(genre_id));

-- ---------- 欠席・遅刻・早退の理由 (§6.4.2) ----------
-- 書かなくてもよい。長文は一覧に収まらないので 40字まで
alter table public.attendances
  add column if not exists reason text
  check (reason is null or char_length(reason) between 1 and 40);
