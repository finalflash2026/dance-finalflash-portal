-- =========================================================
-- 0003_reservations_unique.sql
-- SPEC.md v1.7.1 の差分。Phase 3 (CSV取込) の前提。
--
-- 0001・0002 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- 予約枠の重複を DB でも禁止する (SPEC §9.4 の重複ガード) ----------
-- /api/reservations/bulk は「同一 (date, room_id, start, end) の active な
-- 既存行があればスキップ」する。しかしこれは
--   1. 既存行を select する
--   2. 無かったものを insert する
-- の2段階なので、**折衝係2人が同時に同じCSVを確定すると両方が通る**。
-- 空き申請(claims)の排他制約と同じ考え方で、DB 側にも一意性を持たせる。
--
-- 部分インデックスにして status='active' の行だけを対象にする。
-- 取消(cancelled)にした予約枠と同じ枠を取り直すのは正当な操作であり、
-- これを禁止してしまうと運用が詰まるため。
create unique index if not exists reservations_active_unique
  on public.reservations (date, room_id, start_time, end_time)
  where status = 'active';
