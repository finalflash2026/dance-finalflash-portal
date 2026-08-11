-- =========================================================
-- 開発検証用シード (本番では実行しないこと)
--
-- SPEC.md §15 Phase 1 の受け入れ基準
--   「手投入したslotsが①グリッドに正しく表示される」
-- を確認するためのサンプルデータ。今日の日付で予約枠とコマを作る。
--
-- 前提: 先に /signup でユーザーを1人以上登録しておくこと
--       (reservations.created_by が profiles を参照するため)
--
-- 実行: Supabase SQL Editor に貼り付けて実行
-- 削除: 末尾のクリーンアップ用 SQL をコメント解除して実行
-- =========================================================
do $$
declare
  v_user uuid;
  v_date date := (now() at time zone 'Asia/Tokyo')::date;
  v_kendo uuid;   -- 剣道場(体育館)   room_id=12
  v_rehe  uuid;   -- リハーサル室      room_id=5
  v_prac1 uuid;   -- 練習室1(フレスコ) room_id=2
begin
  select user_id into v_user from public.profiles order by created_at limit 1;
  if v_user is null then
    raise exception '先に /signup でユーザーを1人登録してください (created_by に使います)';
  end if;

  -- ---------- 第1層: 予約枠 ----------
  insert into public.reservations (date, start_time, end_time, room_id, created_by)
  values (v_date, '13:00', '21:30', 12, v_user) returning id into v_kendo;

  insert into public.reservations (date, start_time, end_time, room_id, created_by)
  values (v_date, '13:00', '17:00', 5, v_user) returning id into v_rehe;

  insert into public.reservations (date, start_time, end_time, room_id, created_by)
  values (v_date, '18:00', '22:00', 2, v_user) returning id into v_prac1;

  -- ---------- 第2層: コマ (published=true) ----------
  -- 剣道場: 公式練2つ + 空き + 使用不可
  insert into public.slots
    (reservation_id, date, start_time, end_time, room_id, status, genre_id, target_generations, published, note)
  values
    (v_kendo, v_date, '13:00', '14:50', 12, 'genre', 1,  null,          true, null),
    (v_kendo, v_date, '15:00', '16:50', 12, 'genre', 2,  '{22,23}',     true, '22期・23期のみ'),
    (v_kendo, v_date, '17:00', '19:00', 12, 'open',  null, null,        true, null),
    (v_kendo, v_date, '19:00', '21:30', 12, 'unavailable', null, null,  true, '他団体使用');

  -- リハーサル室: 公式練 + 空き
  insert into public.slots
    (reservation_id, date, start_time, end_time, room_id, status, genre_id, target_generations, published, note)
  values
    (v_rehe, v_date, '13:00', '14:30', 5, 'genre', 7, null, true, null),
    (v_rehe, v_date, '14:30', '17:00', 5, 'open',  null, null, true, null);

  -- 練習室1: 公式練 + 空き (section 違いの列が並ぶことを確認するため)
  insert into public.slots
    (reservation_id, date, start_time, end_time, room_id, status, genre_id, target_generations, published, note)
  values
    (v_prac1, v_date, '18:00', '19:30', 2, 'genre', 5, null, true, null),
    (v_prac1, v_date, '19:30', '22:00', 2, 'open',  null, null, true, null);

  -- ---------- 下書きコマ (published=false) ----------
  -- SPEC §16「member が slots の下書きを読めないこと」の検証用。
  -- member セッションではこの行が見えないのが正しい。
  insert into public.slots
    (reservation_id, date, start_time, end_time, room_id, status, genre_id, target_generations, published, note)
  values
    (v_prac1, v_date + 1, '18:00', '19:30', 2, 'genre', 3, null, false, '下書き(RLS検証用)');

  raise notice '投入しました: date=%  reservations=3  slots=9(うち下書き1)', v_date;
end $$;

-- ---------- クリーンアップ (必要なときにコメント解除して実行) ----------
-- slots は reservations に on delete cascade なので予約枠を消せば連動して消える
-- delete from public.reservations
--  where date between (now() at time zone 'Asia/Tokyo')::date
--                 and (now() at time zone 'Asia/Tokyo')::date + 1;
