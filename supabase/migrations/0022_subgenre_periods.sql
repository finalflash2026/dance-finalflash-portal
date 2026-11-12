-- =========================================================
-- 0022_subgenre_periods.sql
-- SPEC.md v1.31.9 の差分。サブジャンルの変更は今日から先にだけ効かせる (§6.4.1)。
--
-- 0001〜0020 適用済みの環境に対して追加で流す。
-- =========================================================

-- サブジャンルはイベントごとに変わることがある。今までは user_subgenres の
-- 「今の値」だけで予定を引いていたので、変えると**過去の公式練まで**
-- 自分の予定から消えたり増えたりした。いつからいつまでそのサブジャンル
-- だったかを持ち、予定の日付で判定する。
create table public.user_subgenre_periods (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot smallint not null check (slot in (2,3)),
  genre_id smallint not null references public.genres(id),
  from_date date not null,
  to_date date,                      -- null = 今もこのサブジャンル
  check (to_date is null or to_date >= from_date)
);

create index user_subgenre_periods_user_idx on public.user_subgenre_periods (user_id);

alter table public.user_subgenre_periods enable row level security;
-- 読みは user_subgenres と同じく全員。書きはトリガ (security definer) だけ
create policy sel_subg_periods on public.user_subgenre_periods
  for select to authenticated using (true);

-- 今あるサブジャンルは「ずっと前から」として入れる (過去の予定を今までどおり出す)
insert into public.user_subgenre_periods (user_id, slot, genre_id, from_date)
select user_id, slot, genre_id, date '2000-01-01' from public.user_subgenres;

/**
 * user_subgenres が変わったら期間を閉じ・開く。
 * 「今日」は日本時間。今日から新しいサブジャンル、昨日までが前のサブジャンル。
 * 今日始まった期間を今日閉じるときは、閉じずに消す (同じ日に何度変えても重ならない)。
 */
create or replace function public.track_subgenre_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.user_subgenre_periods
      where user_id = old.user_id and slot = old.slot
        and to_date is null and from_date >= v_today;
    update public.user_subgenre_periods
      set to_date = v_today - 1
      where user_id = old.user_id and slot = old.slot and to_date is null;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.user_subgenre_periods (user_id, slot, genre_id, from_date)
    values (new.user_id, new.slot, new.genre_id, v_today);
  end if;

  return null;
end
$$;

create trigger trg_track_subgenre_period
after insert or update or delete on public.user_subgenres
for each row execute function public.track_subgenre_period();
