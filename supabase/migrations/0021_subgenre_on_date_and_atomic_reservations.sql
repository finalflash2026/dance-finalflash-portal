-- =========================================================
-- 0021_subgenre_on_date_and_atomic_reservations.sql
-- SPEC.md v1.32.5 の差分。
--
-- 0001〜0020 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- その日のサブジャンル (§6.4.2) ----------
-- v1.31.9 でカレンダーは「その日にそのジャンルだったか」で練習を出すように
-- したが、出欠の書き込み条件は今のサブジャンル (user_subgenres) を見たままだった。
-- サブジャンルを変えると、カレンダーに出ている過去の練習に出欠を付けられず、
-- 逆に変えた先のジャンルの過去の練習には付けられてしまう。

/** その人がその日に genre を 2/3ジャンに持っていたか */
create or replace function public.had_subgenre_on(p_user uuid, p_genre smallint, p_date date)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_subgenre_periods
    where user_id = p_user and genre_id = p_genre
      and from_date <= p_date and (to_date is null or to_date >= p_date)
  )
$$;

drop policy if exists mod_att on public.attendances;

create policy mod_att on public.attendances for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      (slot_id is not null and public.app_role() <> 'ob' and exists (
         select 1 from public.slots s
         where s.id = slot_id and s.published and s.status = 'genre'
           and (s.genre_id = public.app_main_genre()
                or public.had_subgenre_on(auth.uid(), s.genre_id, s.date))
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
                or public.had_subgenre_on(auth.uid(), g.genre_id, g.date))
           and (g.target_generations is null
                or (select generation from public.profiles p where p.user_id = auth.uid())
                   = any(g.target_generations))))
    )
  );

-- ---------- OB 移行で未来のスタ練の出欠も消す (§3.6) ----------
-- 0006 はスタ練 (0012) より前に書いたため、genre_practice_id 側が残っていた。
create or replace function public.graduate_to_ob(p_user_ids uuid[])
returns int
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_count int;
begin
  -- 1. 未来日の空き申請。過去分は履歴として残す
  delete from public.claims c
  using public.slots s
  where c.slot_id = s.id
    and c.user_id = any(p_user_ids)
    and s.date >= v_today;

  -- 2. 未来日の公式練・スタ練の出欠。ナンバー練 (number_event_id 側) には触らない
  delete from public.attendances a
  using public.slots s
  where a.slot_id = s.id
    and a.user_id = any(p_user_ids)
    and s.date >= v_today;

  delete from public.attendances a
  using public.genre_practices g
  where a.genre_practice_id = g.id
    and a.user_id = any(p_user_ids)
    and g.date >= v_today;

  -- 3. サブジャンル。main_genre_id は username の一部なので保持する
  delete from public.user_subgenres
  where user_id = any(p_user_ids);

  -- 4. ロール。**既にOBの人を数えないよう role <> 'ob' で絞る**
  update public.profiles
  set role = 'ob'
  where user_id = any(p_user_ids)
    and role <> 'ob';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

-- create or replace は権限を引き継ぐが、念のため 0006 と同じに揃えておく
revoke all on function public.graduate_to_ob(uuid[]) from public;
revoke all on function public.graduate_to_ob(uuid[]) from anon, authenticated;
grant execute on function public.graduate_to_ob(uuid[]) to service_role;

-- ---------- 予約枠の取消・つなぎを1回で (§6.2) ----------
-- 画面から別々の通信で書いていたので、途中で失敗すると
-- 「コマだけ消えて枠は残る」「コマは移ったが元の枠が残る」状態になった。
-- 関数の中は1つのトランザクションで、失敗すれば全部戻る。
--
-- **security invoker (既定) のまま。** 呼び出した人の RLS がそのまま効くので、
-- 折衝以上 (all_resv / slots の書き込み) でなければ何も変えられない。

/** 予約枠を取り消し、ぶら下がるコマ (と、cascade で空き申請・出欠) を消す */
create or replace function public.cancel_reservation(p_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.slots where reservation_id = p_id;
  update public.reservations set status = 'cancelled' where id = p_id;
  if not found then
    raise exception 'reservation not found or not permitted' using errcode = '42501';
  end if;
end;
$$;

/**
 * 同じ日・同じ部屋で接している予約枠を、一番早いものに1本にまとめる (v1.29.1)。
 * コマを先に移してから枠を消す (slots.reservation_id は on delete cascade)
 */
create or replace function public.merge_reservations(p_survivor uuid, p_others uuid[], p_end_time time)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.slots set reservation_id = p_survivor where reservation_id = any(p_others);
  update public.reservations set end_time = p_end_time where id = p_survivor;
  if not found then
    raise exception 'reservation not found or not permitted' using errcode = '42501';
  end if;
  delete from public.reservations where id = any(p_others);
end;
$$;

revoke all on function public.cancel_reservation(uuid) from public, anon;
revoke all on function public.merge_reservations(uuid, uuid[], time) from public, anon;
grant execute on function public.cancel_reservation(uuid) to authenticated, service_role;
grant execute on function public.merge_reservations(uuid, uuid[], time) to authenticated, service_role;
