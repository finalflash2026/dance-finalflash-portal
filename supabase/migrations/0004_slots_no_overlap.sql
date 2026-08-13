-- =========================================================
-- 0004_slots_no_overlap.sql
-- SPEC.md v1.8.1 の差分。Phase 3 PR-B (コマ割りエディタ) の前提。
--
-- 0001〜0003 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- 同一予約枠内でコマの時間が重ならないことを保証する ----------
-- SPEC §6.2 Step2-3「同一予約枠内のコマ同士は時間が重ならない」。
--
-- コマは claims と同じく**クライアントから RLS 経由で直接 insert / update する**
-- 設計なので、UI で弾くだけでは
--   1. API を直接叩かれる
--   2. 折衝係2人が同じ予約枠を同時に編集する
-- のどちらでも重なりが通ってしまう。claims の排他制約と同じ考え方で DB 側にも置く。
--
-- 範囲型は claims で定義済みの public.timerange をそのまま使う。
-- btree_gist も 0001 で作成済み (reservation_id の `=` 演算子に必要)。
--
-- 注: 既存データに重なりがあると ERROR: could not create exclusion constraint で
--     失敗する。その場合は下の確認クエリで該当行を洗い出してから消すこと。
--
--   select a.reservation_id, a.id, a.start_time, a.end_time,
--          b.id, b.start_time, b.end_time
--   from public.slots a join public.slots b
--     on a.reservation_id = b.reservation_id and a.id < b.id
--    and a.start_time < b.end_time and b.start_time < a.end_time;
alter table public.slots
  add constraint slots_no_overlap exclude using gist (
    reservation_id with =,
    public.timerange(start_time, end_time) with &&
  );
