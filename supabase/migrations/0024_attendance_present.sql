-- =========================================================
-- 0024_attendance_present.sql
-- SPEC.md v1.36 の差分。出欠に「出席」を答えられるようにする (§6.4.2)。
--
-- 0001〜0023 適用済みの環境に対して追加で流す。
-- =========================================================

-- 今までは「行が無い = 出席」だったので、答えていない人と来る人が見分けられず、
-- コレオが出欠表を信じきれなかった。行が無い人は「未回答」と出し、
-- 来る人は「出席」と答えられるようにする。
--
-- 状態と時刻の CHECK は 0001 で名前を付けずに作ったので、中身で探して外す。
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.attendances'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%absent%'
  loop
    execute format('alter table public.attendances drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.attendances
  add constraint attendances_status_check
  check (status in ('present', 'absent', 'late', 'leave_early'));

-- 時刻が要るのは遅刻・早退だけ (出席・欠席は時刻を持たない)
alter table public.attendances
  add constraint attendances_time_needed
  check (status in ('present', 'absent') or time_value is not null);
