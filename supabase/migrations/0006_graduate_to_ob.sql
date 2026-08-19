-- =========================================================
-- 0006_graduate_to_ob.sql
-- SPEC.md §3.6 (OB/OGへの移行) の自動処理を1トランザクションにまとめる。
--
-- 0001〜0005 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- OB化の自動処理 (SPEC §3.6 / §8.9) ----------
-- 卒業者は削除ではなく `role='ob'` に移行する。そのとき
--   1. 未来日の claims を削除      (練習室の使用権は現役の活動のため)
--   2. 未来日の公式練 attendances を削除 (ナンバー分は保持)
--   3. user_subgenres を削除        (公式練に紐づく設定で無意味になるため)
--   4. role を 'ob' に更新
-- を**まとめて**行う必要がある。
--
-- **なぜ関数にするのか**: supabase-js には複数文をまたぐトランザクションが無い。
-- アプリ側で4本に分けて発行すると、途中で失敗したときに
-- 「ロールはOBなのに未来の申請が残っている」といった中途半端な状態になる。
-- 関数1本なら暗黙のトランザクションで全部が成ったか全部が戻るかになる。
--
-- 複数人を一度に渡せるようにしてあるのは、SPEC §6.5 の
-- 「期を指定して複数人を一括OB化」を同じ経路で通すため。
-- 1人分の移行も要素1つの配列として呼ぶ (経路が分かれると片方だけ直す事故が起きる)。
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

  -- 2. 未来日の公式練の出欠。ナンバー練 (number_event_id 側) には触らない
  delete from public.attendances a
  using public.slots s
  where a.slot_id = s.id
    and a.user_id = any(p_user_ids)
    and s.date >= v_today;

  -- 3. サブジャンル。main_genre_id は username の一部なので保持する
  delete from public.user_subgenres
  where user_id = any(p_user_ids);

  -- 4. ロール。**既にOBの人を数えないよう role <> 'ob' で絞る**
  --    (一括実行の結果表示が「N人を移行しました」なので、実際に変わった数を返す)
  update public.profiles
  set role = 'ob'
  where user_id = any(p_user_ids)
    and role <> 'ob';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

-- **ログイン中のユーザーからは呼べないようにする。**
-- security invoker のままなので、呼び出し元が service_role でなければ
-- RLS に阻まれて何も消せないが、それ以前に execute 権限を落としておく。
-- admin かどうかの判定は API 側 (requireRole) が行う。
revoke all on function public.graduate_to_ob(uuid[]) from public;
revoke all on function public.graduate_to_ob(uuid[]) from anon, authenticated;
grant execute on function public.graduate_to_ob(uuid[]) to service_role;
