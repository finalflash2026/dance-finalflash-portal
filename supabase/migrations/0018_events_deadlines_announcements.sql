-- =========================================================
-- 0018_events_deadlines_announcements.sql
-- SPEC.md v1.30 の差分。サークルイベント・締切・全体告知・
-- 朝のリマインド用の通知カテゴリ (§6.7)。
--
-- 0001〜0017 適用済みの環境に対して追加で流す。
-- =========================================================

-- 3役と折衝 (coordinator 以上) か。RLS から何度も使うので関数にしておく
create or replace function public.is_coordinator_or_above()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('coordinator', 'admin'), false)
$$;

-- ---------- サークルイベント (§6.7.1) ----------
-- 合宿・縦イベ・総会のような、サークル全体の大きな予定。
create table public.circle_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  date date not null,
  -- 複数日 (合宿など)。1日だけなら date と同じ
  end_date date not null,
  -- 時刻は任意。**両方 null なら終日**。片方だけは認めない
  start_time time,
  end_time time,
  place text not null default '',
  note text,
  -- 縦イベのように OB/OG も関わるものだけ OB に見せる (§3.6)
  show_to_ob boolean not null default false,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= date),
  check ((start_time is null) = (end_time is null)),
  -- 1日だけの時刻付きは、終了が開始より後 (日跨ぎは end_date で表す)
  check (
    start_time is null
    or end_date > date
    or end_time > start_time
  )
);

create index circle_events_date_idx on public.circle_events (date, end_date);

alter table public.circle_events enable row level security;

grant select, insert, update, delete on public.circle_events to authenticated;
grant all privileges on public.circle_events to service_role;

create policy sel_cevents on public.circle_events for select to authenticated
  using (public.app_role() <> 'ob' or show_to_ob);

-- **登録できるのは3役と折衝だけ。** 誰でも立てられると、
-- サークル全体の予定として信用できなくなる
create policy ins_cevents on public.circle_events for insert to authenticated
  with check (public.is_coordinator_or_above() and created_by = auth.uid());
create policy upd_cevents on public.circle_events for update to authenticated
  using (public.is_coordinator_or_above())
  with check (public.is_coordinator_or_above());
create policy del_cevents on public.circle_events for delete to authenticated
  using (public.is_coordinator_or_above());

-- ---------- 締切 (§6.7.2) ----------
-- 集金・フォームの提出・2ジャン登録など。**済/未済は持たない**
-- (期限の表示とリマインドだけ)。対象は現役全員。
create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  due_date date not null,
  -- 任意。null は「その日中」
  due_time time,
  url text check (url is null or url ~* '^https?://'),
  note text,
  -- 集金など落とすと困るもの。1週間前にもリマインドする (§6.7.3)
  important boolean not null default false,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deadlines_due_idx on public.deadlines (due_date);

alter table public.deadlines enable row level security;

grant select, insert, update, delete on public.deadlines to authenticated;
grant all privileges on public.deadlines to service_role;

create policy sel_deadlines on public.deadlines for select to authenticated
  using (public.app_role() <> 'ob');
create policy ins_deadlines on public.deadlines for insert to authenticated
  with check (public.is_coordinator_or_above() and created_by = auth.uid());
create policy upd_deadlines on public.deadlines for update to authenticated
  using (public.is_coordinator_or_above())
  with check (public.is_coordinator_or_above());
create policy del_deadlines on public.deadlines for delete to authenticated
  using (public.is_coordinator_or_above());

-- ---------- 全体告知 (§6.7.4) ----------
-- 3役 (admin) だけが送れる。送信はサーバー経由 (全員に通知が飛ぶため)。
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  include_ob boolean not null default false,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create index announcements_created_idx on public.announcements (created_at desc);

alter table public.announcements enable row level security;

grant select, delete on public.announcements to authenticated;
grant all privileges on public.announcements to service_role;

create policy sel_announcements on public.announcements for select to authenticated
  using (public.app_role() <> 'ob' or include_ob);
-- 誤送信の取り消し。insert はサーバー (service role) だけが行う
create policy del_announcements on public.announcements for delete to authenticated
  using (public.app_role() = 'admin');

-- お知らせに告知を入れる。告知を消したらお知らせからも消えるよう参照を持たせる
alter table public.notifications
  add column if not exists announcement_id uuid
    references public.announcements(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('number_added', 'schedule_updated', 'attendance_updated', 'announcement'));

-- ---------- 通知のカテゴリを3つ足す (§6.7.3 / §6.7.4) ----------
alter table public.push_subscriptions
  add column if not exists notify_reminder boolean not null default true,     -- 今日の予定
  add column if not exists notify_deadline boolean not null default true,     -- 締切
  add column if not exists notify_announcement boolean not null default true; -- 3役からの告知
