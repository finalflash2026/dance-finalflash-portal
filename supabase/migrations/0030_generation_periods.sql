-- =========================================================
-- 0030_generation_periods.sql
-- SPEC.md v1.51 の差分。公式練の対象期を「月」ではなく「期間」で決める (§6.2 / §5.2)。
--
-- 0001〜0029 適用済みの環境に対して追加で流す。**1回だけ流す** (create table に
-- if not exists が無いので、2回目はエラーになる)。
-- =========================================================

-- ---------- 期間の表 ----------
-- 大祭の練習は全期、クリスマスパーティーの練習は24期だけ、のように対象は月の途中で変わる。
-- 両端の日を含む。generations が null なら全期 (slots.target_generations と同じ約束)。
create table public.generation_periods (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or char_length(name) between 1 and 40),
  start_date date not null,
  end_date date not null,
  generations smallint[] check (generations is null or cardinality(generations) > 0),
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_periods_dates check (start_date <= end_date),
  -- 1日に効く期間は1つだけ
  constraint generation_periods_no_overlap
    exclude using gist (daterange(start_date, end_date, '[]') with &&)
);

alter table public.generation_periods enable row level security;

-- 見るのは折衝・3役だけ。**直接は書かせない** — 書き込みは下の関数だけが行う
-- (公開済みの練習が変わるかの判定・出欠の削除・お知らせを1回の取引で行うため)
create policy sel_generation_periods on public.generation_periods
  for select to authenticated
  using (public.app_role() in ('coordinator', 'admin'));
revoke insert, update, delete, truncate on public.generation_periods from anon, authenticated;

-- ---------- 今の月ごとの値を期間に移す ----------
-- 月の公式練がすべて同じ対象期 (全期以外) を持つ月を、その月まるごとの期間にする。
-- 食い違う月は移さない (v1.9 より前のコマ。下のトリガはコマを書き換えたときにしか動かないので、値はそのまま残る)。
insert into public.generation_periods (start_date, end_date, generations)
select month_start,
       (month_start + interval '1 month' - interval '1 day')::date,
       min(target_generations::text)::smallint[]
from (
  select date_trunc('month', date)::date as month_start, target_generations
  from public.slots
  where status = 'genre'
) s
group by month_start
having bool_and(target_generations is not null)
   and count(distinct target_generations::text) = 1;

-- ---------- その日の対象期 ----------
create or replace function public.generation_target_on(p_date date)
returns smallint[]
language sql
stable
security definer
set search_path = public
as $$
  select generations from public.generation_periods
  where start_date <= p_date and end_date >= p_date
  limit 1
$$;

revoke all on function public.generation_target_on(date) from public, anon;
grant execute on function public.generation_target_on(date) to authenticated, service_role;

-- ---------- コマの対象期は期間から入れる ----------
-- 画面から送った値は使わない。どの経路で作ったコマ (表・タイムライン・案の下書き・公開時の空き) でも
-- 同じ値になり、折衝が公開済みのコマの対象期を直接書き換えることもできなくなる。
create or replace function public.slots_target_from_period()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.target_generations := case
    when new.status = 'genre' then public.generation_target_on(new.date)
  end;
  return new;
end;
$$;

create trigger slots_target_from_period
  before insert or update of date, status, target_generations on public.slots
  for each row execute function public.slots_target_from_period();

-- ---------- 期間を変えたあとに、コマ・出欠・お知らせをそろえる ----------
-- 今日から先の公式練の対象期を入れ直す。過去の練習は対象期も出欠もそのまま残す (履歴)。
-- 公開済みで値が変わったコマについて:
--   p_allow_published が false (折衝) なら全体を取り消す — 公開済みの練習を変えられるのは3役だけ
--   対象から外れた人の出欠を消す
--   対象が変わった人 (そのジャンルを1〜3ジャンに持つ現役のうち、入った人・外れた人) にお知らせを入れる
-- 外からは呼ばせない (save / delete の中だけで使う)。
create or replace function public.refresh_slot_targets(p_from date, p_to date, p_allow_published boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := greatest(p_from, (now() at time zone 'Asia/Tokyo')::date);
  v_diff jsonb;
  v_removed int := 0;
  v_users uuid[];
  v_first date;
  v_last date;
  v_range text;
begin
  if p_to is null or v_from > p_to then
    return jsonb_build_object('changed', 0, 'removed', 0, 'notified', '[]'::jsonb);
  end if;

  -- 変わるコマだけを書き換え、前の値と一緒に覚える (FROM の中は書き換える前の値を読む)
  with changed as (
    update public.slots s
       set target_generations = public.generation_target_on(s.date)
      from (
        select id, target_generations as old_target
        from public.slots
        where status = 'genre' and date between v_from and p_to
      ) o
     where s.id = o.id
       and o.old_target is distinct from public.generation_target_on(s.date)
    returning s.id, s.date, s.genre_id, s.published, o.old_target, s.target_generations as new_target
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'date', date, 'genre_id', genre_id,
           'old_target', old_target, 'new_target', new_target)), '[]'::jsonb)
    into v_diff
    from changed
   where published;

  if jsonb_array_length(v_diff) = 0 then
    return jsonb_build_object('changed', 0, 'removed', 0, 'notified', '[]'::jsonb);
  end if;

  if not p_allow_published then
    raise exception 'published slots change' using errcode = 'P0001',
      hint = '公開済みの公式練の対象期が変わります';
  end if;

  delete from public.attendances a
   using jsonb_to_recordset(v_diff) as d(id uuid, new_target smallint[]),
         public.profiles p
   where a.slot_id = d.id
     and p.user_id = a.user_id
     and d.new_target is not null
     and not (p.generation = any(d.new_target));
  get diagnostics v_removed = row_count;

  select coalesce(array_agg(distinct p.user_id), '{}'::uuid[])
    into v_users
    from jsonb_to_recordset(v_diff)
           as d(date date, genre_id smallint, old_target smallint[], new_target smallint[])
    join public.profiles p
      on p.role not in ('ob', 'viewer')
     and (p.main_genre_id = d.genre_id or public.had_subgenre_on(p.user_id, d.genre_id, d.date))
     and (d.old_target is null or p.generation = any(d.old_target))
         is distinct from (d.new_target is null or p.generation = any(d.new_target));

  if cardinality(v_users) > 0 then
    select min(date), max(date) into v_first, v_last
      from jsonb_to_recordset(v_diff) as d(date date);
    v_range := to_char(v_first, 'FMMM/FMDD')
      || case when v_last > v_first then '〜' || to_char(v_last, 'FMMM/FMDD') else '' end;
    insert into public.notifications (user_id, type, title, body)
    select u, 'schedule_updated', '公式練の対象期が変わりました',
           v_range || ' の分。カレンダーで確認してください'
      from unnest(v_users) as u;
  end if;

  return jsonb_build_object(
    'changed', jsonb_array_length(v_diff),
    'removed', v_removed,
    'notified', to_jsonb(v_users));
end;
$$;

revoke all on function public.refresh_slot_targets(date, date, boolean) from public, anon, authenticated;
grant execute on function public.refresh_slot_targets(date, date, boolean) to service_role;

-- ---------- 期間を1つ保存する ----------
-- p_id が null なら新しく作る。編集では読んだときの updated_at を渡す (ほかの人が先に変えていたら止める)。
-- **保存する期間が優先**: 重なる期間を短くし、中に収まる期間を消し、両側にはみ出す期間を2つに分ける。
-- p_generations が空なら全期。
create or replace function public.save_generation_period(
  p_id uuid,
  p_updated_at timestamptz,
  p_name text,
  p_start date,
  p_end date,
  p_generations smallint[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_generations smallint[];
  v_old_start date;
  v_old_end date;
  v_id uuid := p_id;
  r record;
begin
  if v_role is null or v_role not in ('coordinator', 'admin') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start > p_end
     or (v_name is not null and char_length(v_name) > 40) then
    raise exception 'invalid period' using errcode = '22023';
  end if;

  -- 同じ期が2回来ても1つにし、大きい期から並べる (コマの値と比べるときに順番で食い違わないように)
  select case when count(*) = 0 then null else array_agg(g order by g desc) end
    into v_generations
    from (
      select distinct g
      from unnest(coalesce(p_generations, '{}'::smallint[])) as g
      where g is not null
    ) s;

  -- 保存と削除は1つずつ順に行う (同時に重なる期間を作らせない)
  lock table public.generation_periods in share row exclusive mode;

  if p_id is not null then
    select start_date, end_date into v_old_start, v_old_end
      from public.generation_periods
     where id = p_id and updated_at = p_updated_at;
    if not found then
      raise exception 'stale period' using errcode = 'P0001',
        hint = 'ほかの人が先にこの期間を変えました';
    end if;
  end if;

  -- 中に収まる期間は消す
  delete from public.generation_periods
   where id is distinct from p_id
     and start_date >= p_start and end_date <= p_end;

  -- 両側にはみ出す期間は2つに分ける (前を縮めてから、後ろを新しい行で足す)
  for r in
    select * from public.generation_periods
     where id is distinct from p_id
       and start_date < p_start and end_date > p_end
  loop
    update public.generation_periods
       set end_date = p_start - 1, updated_at = now()
     where id = r.id;
    insert into public.generation_periods (name, start_date, end_date, generations, created_by)
    values (r.name, p_end + 1, r.end_date, r.generations, r.created_by);
  end loop;

  -- 片側だけ重なる期間は短くする
  update public.generation_periods
     set end_date = p_start - 1, updated_at = now()
   where id is distinct from p_id
     and start_date < p_start and end_date >= p_start;
  update public.generation_periods
     set start_date = p_end + 1, updated_at = now()
   where id is distinct from p_id
     and start_date <= p_end and end_date > p_end;

  if p_id is null then
    insert into public.generation_periods (name, start_date, end_date, generations, created_by)
    values (v_name, p_start, p_end, v_generations, auth.uid())
    returning id into v_id;
  else
    update public.generation_periods
       set name = v_name, start_date = p_start, end_date = p_end,
           generations = v_generations, updated_at = now()
     where id = p_id;
  end if;

  -- 前の範囲と新しい範囲の両方を入れ直す (動かした・縮めた所が全期に戻るため)
  return public.refresh_slot_targets(
           least(p_start, coalesce(v_old_start, p_start)),
           greatest(p_end, coalesce(v_old_end, p_end)),
           v_role = 'admin')
         || jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.save_generation_period(uuid, timestamptz, text, date, date, smallint[]) from public, anon;
grant execute on function public.save_generation_period(uuid, timestamptz, text, date, date, smallint[]) to authenticated, service_role;

-- ---------- 期間を1つ消す ----------
-- 消した日はどの期間にも入らなくなるので全期に戻る。
create or replace function public.delete_generation_period(p_id uuid, p_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_role();
  v_start date;
  v_end date;
begin
  if v_role is null or v_role not in ('coordinator', 'admin') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  lock table public.generation_periods in share row exclusive mode;

  delete from public.generation_periods
   where id = p_id and updated_at = p_updated_at
  returning start_date, end_date into v_start, v_end;
  if not found then
    raise exception 'stale period' using errcode = 'P0001',
      hint = 'ほかの人が先にこの期間を変えました';
  end if;

  return public.refresh_slot_targets(v_start, v_end, v_role = 'admin')
         || jsonb_build_object('id', p_id);
end;
$$;

revoke all on function public.delete_generation_period(uuid, timestamptz) from public, anon;
grant execute on function public.delete_generation_period(uuid, timestamptz) to authenticated, service_role;
