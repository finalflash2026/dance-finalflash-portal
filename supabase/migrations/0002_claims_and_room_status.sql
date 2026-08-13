-- =========================================================
-- 0002_claims_and_room_status.sql
-- SPEC.md v1.7 の差分。Phase 2 (空き申請・施錠状況ボード) の前提。
--
-- 0001 適用済みの環境に対して追加で流す。既存データには影響しない
-- (claims はまだ1件も無く、room_status はトリガ追加のみ)。
-- =========================================================

-- ---------- (a) 申請時刻を10分刻みに強制 (SPEC §6.1 / v1.7) ----------
-- 粒度は v1.7 で 15分 → 10分 に変更。
-- claims はクライアントから RLS 経由で直接 insert する設計のため、
-- UI で丸めるだけでは API 直叩きで回避できる。DB でも強制する。
--
-- extract(epoch from time) は0時からの秒数。600秒=10分で割り切れるかを見れば、
-- 分の粒度と秒がゼロであることを同時に検証できる。
alter table public.claims
  add constraint claims_ten_minutes check (
    extract(epoch from start_time)::int % 600 = 0
    and extract(epoch from end_time)::int % 600 = 0
  );

-- ---------- (b) room_status.updated_at を UPDATE でも更新する ----------
-- updated_at は default now() だけだと **UPDATE では更新されない**。
-- §6.1.1 の「○のまま最終更新から3時間以上経過した行は淡色表示」は
-- この値に依存するため、更新されないと警告が永久に出ない。
--
-- クライアントから時刻を送る案は時計ずれと詐称の余地があるので、
-- BEFORE トリガでサーバー時刻を必ず入れる。
create or replace function public.touch_room_status_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_room_status_touch
before insert or update on public.room_status
for each row execute function public.touch_room_status_updated_at();
