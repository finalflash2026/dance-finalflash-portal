-- =========================================================
-- 0028_schedule_rounds.sql
-- SPEC.md v1.44 の差分。日程調整の回と回答を DB に持つ (§6.8.5)。
--
-- 0001〜0027 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- 回 ----------
-- 1か月に1回だけ。候補 (日 × コマの時間) は持たず、その月の予約枠から毎回作る
create table if not exists public.schedule_rounds (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  deadline date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.schedule_rounds enable row level security;

-- プロフィールのある人は読める (ホームのカード・回答の画面)。
-- 書き込みはサーバー経由だけ (始めると全員に通知が届くため。§13.2) なので、方針を置かない
drop policy if exists sel_schedule_rounds on public.schedule_rounds;
create policy sel_schedule_rounds on public.schedule_rounds for select to authenticated
  using (public.app_role() is not null);

-- ---------- 回答 ----------
-- 行が無い = 未回答。未回答に戻すと行を消す
create table if not exists public.schedule_answers (
  round_id uuid not null references public.schedule_rounds(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  answer text not null check (answer in ('ok', 'maybe', 'no')),
  updated_at timestamptz not null default now(),
  primary key (round_id, user_id, date, start_time, end_time)
);
create index if not exists schedule_answers_round_idx on public.schedule_answers (round_id);

alter table public.schedule_answers enable row level security;

-- 受付中で、締切の日 (日本時間) を過ぎていない回か
create or replace function public.schedule_round_accepting(p_round uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.schedule_rounds r
    where r.id = p_round
      and r.status = 'open'
      and (now() at time zone 'Asia/Tokyo')::date <= r.deadline
  );
$$;

-- 自分の行と、折衝・3役は全員分を読める
drop policy if exists sel_schedule_answers on public.schedule_answers;
create policy sel_schedule_answers on public.schedule_answers for select to authenticated
  using (user_id = auth.uid() or public.is_coordinator_or_above());

-- 自分の行だけ、受付中の回にだけ書ける。OB は書けない
drop policy if exists ins_schedule_answers on public.schedule_answers;
create policy ins_schedule_answers on public.schedule_answers for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.app_role() is not null
    and public.app_role() <> 'ob'
    and public.schedule_round_accepting(round_id)
  );

drop policy if exists upd_schedule_answers on public.schedule_answers;
create policy upd_schedule_answers on public.schedule_answers for update to authenticated
  using (user_id = auth.uid() and public.schedule_round_accepting(round_id))
  with check (
    user_id = auth.uid()
    and public.app_role() <> 'ob'
    and public.schedule_round_accepting(round_id)
  );

drop policy if exists del_schedule_answers on public.schedule_answers;
create policy del_schedule_answers on public.schedule_answers for delete to authenticated
  using (user_id = auth.uid() and public.schedule_round_accepting(round_id));

-- ---------- お知らせの種類 ----------
-- 日程調整を始めたとき、現役全員のお知らせに入れる (押すと回答の画面へ)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('number_added', 'schedule_updated', 'attendance_updated', 'announcement', 'schedule_round'));
