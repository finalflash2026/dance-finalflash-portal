-- =========================================================
-- 0029_viewer_schedule_answers.sql
-- SPEC.md v1.46 の差分。main の「閲覧のみ」(0018・0019) を日程調整 (0028) にも効かせる (§3.6 / §3.8)。
--
-- 0001〜0028 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- 閲覧のみは日程調整に答えられない ----------
-- 0028 の許可ポリシーは app_role() <> 'ob' なので閲覧のみも通ってしまう。
-- 0018 と同じく restrictive を重ねる (許可ポリシーには触らない)
drop policy if exists no_viewer_insert on public.schedule_answers;
create policy no_viewer_insert on public.schedule_answers as restrictive
  for insert to authenticated
  with check (public.app_role() is distinct from 'viewer');
drop policy if exists no_viewer_update on public.schedule_answers;
create policy no_viewer_update on public.schedule_answers as restrictive
  for update to authenticated
  using (public.app_role() is distinct from 'viewer')
  with check (public.app_role() is distinct from 'viewer');
drop policy if exists no_viewer_delete on public.schedule_answers;
create policy no_viewer_delete on public.schedule_answers as restrictive
  for delete to authenticated
  using (public.app_role() is distinct from 'viewer');

-- ---------- OB化・閲覧のみへの切り替えで、今月から先の日程調整の回答も消す ----------
-- 回答は「人ごとの未来の予定」なので、残すと割り振りの計算に入り続ける。
-- graduate_to_ob と make_viewer の**両方**に足す (片方だけだと 0019 で直したのと同じずれが起きる)。
-- 中身は 0019 / 0018 に、5. の削除を足したもの

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

  -- 4. 今月から先の日程調整の回答 (v1.46)
  delete from public.schedule_answers sa
  using public.schedule_rounds r
  where sa.round_id = r.id
    and sa.user_id = any(p_user_ids)
    and r.month >= date_trunc('month', v_today)::date;

  -- 5. ロール。既にOBの人を数えないよう role <> 'ob' で絞る
  update public.profiles
  set role = 'ob'
  where user_id = any(p_user_ids)
    and role <> 'ob';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.graduate_to_ob(uuid[]) from public;
revoke all on function public.graduate_to_ob(uuid[]) from anon, authenticated;
grant execute on function public.graduate_to_ob(uuid[]) to service_role;

create or replace function public.make_viewer(p_user_ids uuid[])
returns int
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_count int;
begin
  delete from public.claims c using public.slots s
   where c.slot_id = s.id and c.user_id = any(p_user_ids) and s.date >= v_today;
  delete from public.attendances a using public.slots s
   where a.slot_id = s.id and a.user_id = any(p_user_ids) and s.date >= v_today;
  delete from public.attendances a using public.genre_practices g
   where a.genre_practice_id = g.id and a.user_id = any(p_user_ids) and g.date >= v_today;
  delete from public.user_subgenres where user_id = any(p_user_ids);
  -- 今月から先の日程調整の回答 (v1.46)
  delete from public.schedule_answers sa using public.schedule_rounds r
   where sa.round_id = r.id and sa.user_id = any(p_user_ids)
     and r.month >= date_trunc('month', v_today)::date;
  update public.profiles set role = 'viewer'
   where user_id = any(p_user_ids) and role <> 'viewer';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.make_viewer(uuid[]) from public;
revoke all on function public.make_viewer(uuid[]) from anon, authenticated;
grant execute on function public.make_viewer(uuid[]) to service_role;
