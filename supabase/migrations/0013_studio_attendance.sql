-- =========================================================
-- 0013_studio_attendance.sql
-- SPEC.md v1.24 の差分。スタ練にも出欠を付ける (§6.3.1 / §6.4.2)。
--
-- 0001〜0012 適用済みの環境に対して追加で流す。
-- =========================================================

-- スタ練も公式練・ナンバー練と同じように出欠を答えられるようにする。
-- 「行けない」「遅れる」を先に共有したいのは、主催が公式かどうかとは
-- 関係がなかった。
alter table public.attendances
  add column if not exists genre_practice_id uuid
    references public.genre_practices(id) on delete cascade;

-- 3つのうちどれか1つだけを指す、という条件を作り直す。
-- **既存の制約を落としてから足す。** num_nonnulls(...) = 1 のままだと
-- 新しい列を足した時点で、スタ練の行が「2つ指している」と誤判定される
-- わけではないが、スタ練だけを指す行が通らない。
alter table public.attendances
  drop constraint if exists attendances_check;

alter table public.attendances
  add constraint attendances_target_exactly_one
  check (num_nonnulls(slot_id, number_event_id, genre_practice_id) = 1);

-- 1人1スタ練につき1行
alter table public.attendances
  add constraint attendances_user_genre_practice_unique
  unique (user_id, genre_practice_id);

-- ---------- 閲覧 ----------
-- スタ練の出欠は**そのジャンルの人なら誰でも見える**。
-- 公式練 (slot_id is not null で全員可) と同じ扱いで、
-- 「誰が来るか」を共有するのが目的のため。
drop policy if exists sel_att on public.attendances;

create policy sel_att on public.attendances for select to authenticated
  using (
    slot_id is not null
    or exists (select 1 from public.number_events e
               where e.id = number_event_id
                 and public.is_number_member(e.number_id, auth.uid()))
    or exists (select 1 from public.genre_practices g
               where g.id = genre_practice_id
                 and public.app_role() <> 'ob'
                 and (g.genre_id = public.app_main_genre()
                      or g.genre_id in (select genre_id from public.user_subgenres s
                                        where s.user_id = auth.uid())))
  );

-- ---------- 書き込み ----------
-- **答えられるのは、そのスタ練の対象になっている人だけ。**
-- 自分に関係のない練習の出欠を出せると、主催側は誰が来るのか
-- 数えられなくなる。公式練と同じ考え方 (ジャンルが一致すること)。
--
-- 公式練と違い**期の条件は無い** — スタ練は有志の集まりで、
-- 来たい人が来る (§6.3.1)。
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
                                  where s.user_id = auth.uid()))))
    )
  );
