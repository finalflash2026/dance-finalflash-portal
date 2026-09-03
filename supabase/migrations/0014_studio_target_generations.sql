-- =========================================================
-- 0014_studio_target_generations.sql
-- SPEC.md v1.25 の差分。スタ練に対象期を持たせる (§6.3.1)。
--
-- 0001〜0013 適用済みの環境に対して追加で流す。
-- =========================================================

-- スタ練は「折衝が公式練としてコマを割り振っていないだけで、中身は公式練」。
-- 公式練が対象期を持つ以上、スタ練も持たせないと
-- 「1年生だけの基礎練」のような回を立てられない。
--
-- `null` = 期を問わない。公式練 (slots.target_generations) と同じ約束。
alter table public.genre_practices
  add column if not exists target_generations smallint[];

-- ---------- 出欠の書き込み条件を作り直す ----------
-- 対象期の外にいる人は、そもそもその予定が自分のカレンダーに出ない。
-- **出欠だけ答えられる状態を残さない**ため、書き込み側にも同じ条件を置く。
-- 公式練 (slots) の条件と同じ形にしてある。
drop policy if exists mod_att on public.attendances;

create policy mod_att on public.attendances for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      (slot_id is not null and public.app_role() <> 'ob' and exists (
         select 1 from public.slots s
         where s.id = slot_id and s.published and s.status = 'genre'
           and (s.genre_id = (select main_genre_id from public.profiles p where p.user_id = auth.uid())
                or s.genre_id in (select genre_id from public.user_subgenres g where g.user_id = auth.uid()))
           and (s.target_generations is null
                or (select generation from public.profiles p where p.user_id = auth.uid())
                   = any(s.target_generations))))
      or
      (number_event_id is not null and exists (
         select 1 from public.number_events e
         where e.id = number_event_id
           and public.is_number_member(e.number_id, auth.uid())))
      or
      (genre_practice_id is not null and public.app_role() <> 'ob' and exists (
         select 1 from public.genre_practices g
         where g.id = genre_practice_id
           and (g.genre_id = public.app_main_genre()
                or g.genre_id in (select genre_id from public.user_subgenres s
                                  where s.user_id = auth.uid()))
           and (g.target_generations is null
                or (select generation from public.profiles p where p.user_id = auth.uid())
                   = any(g.target_generations))))
    )
  );
