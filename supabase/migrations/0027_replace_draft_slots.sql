-- =========================================================
-- 0027_replace_draft_slots.sql
-- SPEC.md v1.36 の差分。日程調整の案をコマ割りの下書きに入れる (§6.8.4)。
--
-- 0001〜0026 適用済みの環境に対して追加で流す。
-- =========================================================

-- その月の**公開していないコマ**を消して、案のコマを下書きで作る。
-- 消すのと作るのを1回で行う (途中で失敗すると下書きが空のまま残るため)。
-- 公開済みのコマがある月では作らない (上書きで空き申請が消えるのを防ぐ)。
--
-- p_slots: [{ "date": "2026-12-02", "room_id": 1, "start_time": "18:00",
--             "end_time": "19:30", "genre_id": 3 }, ...]
-- 各コマは、同じ日・同じ部屋で時間が収まる予約枠 (active) にぶら下げる。
-- 予約枠が見つからないコマは作らない (数を返すので、画面で差が分かる)。
--
-- **security invoker のまま。** 呼び出した人の RLS が効くので、折衝以上でなければ
-- 消すことも作ることもできない (reservations / slots は折衝以上だけ)。
create or replace function public.replace_draft_slots(p_month date, p_slots jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_end date := (p_month + interval '1 month')::date;
  v_count int;
begin
  if public.app_role() not in ('coordinator', 'admin') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.slots where date >= p_month and date < v_end and published) then
    raise exception 'published slots exist' using errcode = 'P0001',
      hint = 'この月には公開済みのコマがあります';
  end if;

  delete from public.slots where date >= p_month and date < v_end and not published;

  insert into public.slots (reservation_id, date, start_time, end_time, room_id, status, genre_id, published)
  select r.id, s.date, s.start_time, s.end_time, s.room_id, 'genre', s.genre_id, false
  from jsonb_to_recordset(p_slots)
         as s(date date, room_id smallint, start_time time, end_time time, genre_id smallint)
  join lateral (
    select id from public.reservations r
    where r.status = 'active' and r.date = s.date and r.room_id = s.room_id
      and r.start_time <= s.start_time and r.end_time >= s.end_time
    order by r.start_time
    limit 1
  ) r on true
  where s.date >= p_month and s.date < v_end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_draft_slots(date, jsonb) from public, anon;
grant execute on function public.replace_draft_slots(date, jsonb) to authenticated, service_role;
