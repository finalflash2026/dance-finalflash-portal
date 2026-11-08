-- =========================================================
-- 0019_graduate_studio_attendance.sql
-- SPEC.md §3.6 / v1.30.1
--
-- OB化 (graduate_to_ob) で**未来のスタ練の出欠も消す**。
--
-- graduate_to_ob (0006) はスタ練 (0012/0013) より前に書かれたので、
-- 公式練の出欠 (slot_id 側) しか消していなかった。閲覧のみへの切り替え
-- (make_viewer / 0018) は最初からスタ練の分も消しているので、それに揃える。
--
-- 残したままでも画面には出ない (スタ練の参加者一覧に OB は載らない) が、
-- その人を現役に戻すと**卒業前の未来の出欠が復活する**。
--
-- 適用時点で OB に残っている未来のスタ練の出欠は 0件だったため
-- (2026-11-09 に本番で確認)、データの掃除は入れていない。
--
-- 0018 適用済みの環境に対して追加で流す。何度流しても同じ結果になる。
-- =========================================================

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

  -- 2. 未来日の公式練の出欠
  delete from public.attendances a
  using public.slots s
  where a.slot_id = s.id
    and a.user_id = any(p_user_ids)
    and s.date >= v_today;

  -- 3. 未来日のスタ練の出欠 (0019 で追加)。
  --    ナンバー練 (number_event_id 側) には触らない — OB も縦イベで続けるため
  delete from public.attendances a
  using public.genre_practices g
  where a.genre_practice_id = g.id
    and a.user_id = any(p_user_ids)
    and g.date >= v_today;

  -- 4. サブジャンル。main_genre_id は username の一部なので保持する
  delete from public.user_subgenres
  where user_id = any(p_user_ids);

  -- 5. ロール。既にOBの人は数えない (結果表示が「N人を移行しました」なので)
  update public.profiles
  set role = 'ob'
  where user_id = any(p_user_ids)
    and role <> 'ob';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

-- create or replace は権限を引き継ぐが、念のため 0006 と同じ形で付け直す
revoke all on function public.graduate_to_ob(uuid[]) from public;
revoke all on function public.graduate_to_ob(uuid[]) from anon, authenticated;
grant execute on function public.graduate_to_ob(uuid[]) to service_role;
