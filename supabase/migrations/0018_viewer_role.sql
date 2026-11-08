-- =========================================================
-- 0018_viewer_role.sql
-- SPEC.md v1.30 の差分。「閲覧のみ」の権限を足す (§3.1 / §3.7)。
--
-- 0001〜0017 適用済みの環境に対して追加で流す。
-- =========================================================

-- 引退した人がアプリを見続けられるようにする。OB にすると全体カレンダーが
-- 見えなくなる (§3.6) が、作った人・前任の保守担当は引退後も全体を見たい。
--
-- 条件は2つ:
--   1. **現役の邪魔をしない** … 書き込みは一切できない
--   2. **名簿に載らない**     … 出欠の参加者・通知の宛先・対象期の候補に出ない
--
-- 2 は画面側 (クエリで外す) で行い、1 はここで DB に持たせる。
-- 画面のボタンを隠すだけでは、API や Supabase を直接叩かれると書けてしまう。

-- ---------- 1. role に viewer を足す ----------
-- 0001 で列に直接書いた check の名前は Postgres が決めている
-- (通常は profiles_role_check)。**名前を決め打ちにしない** — 違っていた場合に
-- 古い制約が残り、viewer に変えようとしても弾かれ続ける。
do $$
declare
  c text;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ob', 'member', 'coordinator', 'admin', 'viewer'));

-- ---------- 2. 閲覧のみは書けない ----------
-- **既存のポリシーには触らない。** restrictive (制限) ポリシーは、既にある
-- 許可のポリシーと AND で効く。本番で動いている規則を1本ずつ書き換えるより、
-- 「閲覧のみなら全部だめ」を上に重ねるほうが壊しにくい。
--
-- 対象は、メンバーが自分で書き込める表すべて。
-- 折衝以上しか書けない表 (予約枠・コマ・コマの時間など) は元から閉じている。
-- 通知の既読・プッシュ購読・表示名は本人だけの設定で、現役に影響しないので外す。
--
-- `is distinct from` にしてあるのは、プロフィールの無いユーザー
-- (app_role() が null) をここで巻き込まないため。そちらは元の規則が判定する。
do $$
declare
  t text;
begin
  foreach t in array array[
    'claims',            -- 空き申請
    'attendances',       -- 出欠
    'room_status',       -- 施錠状況
    'board_messages',    -- 連絡欄
    'club_key_holders',  -- 部室の鍵
    'genre_practices',   -- スタ練
    'numbers',           -- ナンバー
    'number_members',
    'number_events',
    'user_subgenres'     -- 2・3ジャン (出欠の参加者が変わる)
  ] loop
    execute format('drop policy if exists no_viewer_insert on public.%I', t);
    execute format('drop policy if exists no_viewer_update on public.%I', t);
    execute format('drop policy if exists no_viewer_delete on public.%I', t);

    execute format(
      'create policy no_viewer_insert on public.%I as restrictive
         for insert to authenticated
         with check (public.app_role() is distinct from ''viewer'')', t);
    execute format(
      'create policy no_viewer_update on public.%I as restrictive
         for update to authenticated
         using (public.app_role() is distinct from ''viewer'')
         with check (public.app_role() is distinct from ''viewer'')', t);
    execute format(
      'create policy no_viewer_delete on public.%I as restrictive
         for delete to authenticated
         using (public.app_role() is distinct from ''viewer'')', t);
  end loop;
end $$;

-- ---------- 3. 閲覧のみへの切り替え ----------
-- OB への移行 (graduate_to_ob) と同じく、**未来の活動を消してから**ロールを変える。
-- 残すと、見るだけの人の名前が未来の空き申請や出欠に載ったままになる。
--
-- graduate_to_ob と違い**スタ練の出欠も消す**。スタ練の出欠は 0013 で
-- 後から足したもので、graduate_to_ob はそれより前に書かれている。
--
-- ナンバーの所属と、その出欠は残す (OB と同じ)。誰かが明示的に入れたもので、
-- 抜けるかどうかは本人とナンバーの主催が決める。
create or replace function public.make_viewer(p_user_ids uuid[])
returns int
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_count int;
begin
  -- 未来日の空き申請
  delete from public.claims c
  using public.slots s
  where c.slot_id = s.id
    and c.user_id = any(p_user_ids)
    and s.date >= v_today;

  -- 未来日の公式練の出欠
  delete from public.attendances a
  using public.slots s
  where a.slot_id = s.id
    and a.user_id = any(p_user_ids)
    and s.date >= v_today;

  -- 未来日のスタ練の出欠
  delete from public.attendances a
  using public.genre_practices g
  where a.genre_practice_id = g.id
    and a.user_id = any(p_user_ids)
    and g.date >= v_today;

  -- 2・3ジャン。出欠の参加者を決める設定で、見るだけの人には要らない
  delete from public.user_subgenres
  where user_id = any(p_user_ids);

  update public.profiles
  set role = 'viewer'
  where user_id = any(p_user_ids)
    and role <> 'viewer';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

-- graduate_to_ob と同じく、ログイン中のユーザーからは呼ばせない。
-- 3役かどうかの判定は API 側 (requireRole) が行う
revoke all on function public.make_viewer(uuid[]) from public;
revoke all on function public.make_viewer(uuid[]) from anon, authenticated;
grant execute on function public.make_viewer(uuid[]) to service_role;
