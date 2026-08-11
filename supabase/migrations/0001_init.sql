-- =========================================================
-- 0001_init.sql  ダンスサークル練習管理  初期スキーマ
-- SPEC.md §5.2 の全文。Supabase SQL Editor または CLI で適用する。
-- =========================================================
-- Supabase では拡張が extensions スキーマに入っていることがある。
-- claims の排他制約が btree_gist の演算子クラスを解決できるよう、
-- 両スキーマを検索パスに入れておく(存在しないスキーマ名は無視されるので安全)。
set search_path = public, extensions;

create extension if not exists pgcrypto;

-- 注: RLS ヘルパー関数 (app_role / is_number_member) は、参照するテーブルを
--     作った後でなければ作成できないため、テーブル定義の後・RLS の前に置いてある。
--     language sql の関数は作成時に本体が検証されるため
--     (check_function_bodies は既定 on)、先に書くと 42P01 で失敗する。

-- ---------- マスタ ----------
create table public.genres (
  id smallint primary key,
  code text unique not null,          -- 'BREAK' 等
  sort_order smallint not null
);

create table public.rooms (
  id smallint primary key,
  name text unique not null,
  section text not null,              -- '7号館'/'フレスコ'/'講堂'/'アリーナ'
  sort_order smallint not null
);

create table public.room_aliases (
  alias text primary key,
  room_id smallint not null references public.rooms(id)
);

-- ---------- ユーザー ----------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,          -- 22BREAKせいあ
  generation smallint not null,           -- 期
  main_genre_id smallint not null references public.genres(id),
  display_name text not null,             -- 名前部分
  role text not null default 'member' check (role in ('ob','member','coordinator','admin')),
  created_at timestamptz not null default now()
);

create table public.user_subgenres (      -- 2ジャン・3ジャン
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot smallint not null check (slot in (2,3)),
  genre_id smallint not null references public.genres(id),
  primary key (user_id, slot)
);

-- ---------- 第1層: 予約枠 ----------
create table public.import_files (
  id uuid primary key default gen_random_uuid(),
  filename text not null,                 -- アップロードされたCSVのファイル名(監査用)
  row_count int not null default 0,       -- 取り込んだ行数
  uploaded_by uuid not null references public.profiles(user_id),
  status text not null default 'pending' check (status in ('pending','confirmed')),
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  import_file_id uuid references public.import_files(id),
  date date not null,
  start_time time not null,
  end_time time not null,
  room_id smallint not null references public.rooms(id),
  status text not null default 'active' check (status in ('active','cancelled')),
  note text,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

-- ---------- 第2層: コマ ----------
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  room_id smallint not null references public.rooms(id),
  status text not null check (status in ('genre','open','unavailable')),
  genre_id smallint references public.genres(id),     -- status='genre' のとき必須
  target_generations smallint[],                      -- null=全期対象
  published boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  check (start_time < end_time),
  check (status <> 'genre' or genre_id is not null)
);
create index on public.slots (date, room_id);
create index on public.slots (published, date);

-- ---------- 第3層: 空き申請(自由時間帯・v1.1変更) ----------
-- 空きコマ(slots.status='open')の範囲内で、開始/終了を自由に選んで申請する。
-- 同一コマ内の時間帯重複は排他制約で禁止(=先着保証)。
create extension if not exists btree_gist;
create type public.timerange as range (subtype = time);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  start_time time not null,
  end_time time not null,
  purpose text,                            -- 用途メモ(任意)
  created_at timestamptz not null default now(),
  check (start_time < end_time),
  exclude using gist (
    slot_id with =,
    public.timerange(start_time, end_time) with &&
  )
);
-- 申請時間の粒度はUIで15分刻みに丸める(§6.1)。

-- ---------- 第3層: ナンバー ----------
create table public.numbers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.number_members (
  number_id uuid not null references public.numbers(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (number_id, user_id)
);

create table public.number_events (
  id uuid primary key default gen_random_uuid(),
  number_id uuid not null references public.numbers(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  place text not null,                     -- 自由記入(レンタルスタジオ名等)
  note text,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

-- 作成者を自動でメンバーに追加
create or replace function public.add_owner_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.number_members (number_id, user_id) values (new.id, new.owner_id)
  on conflict do nothing;
  return new;
end $$;
create trigger trg_numbers_owner_member
after insert on public.numbers
for each row execute function public.add_owner_as_member();

-- ---------- 購読トークン ----------
create table public.calendar_tokens (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  token text unique not null,              -- 32byte以上のURL-safeランダム
  created_at timestamptz not null default now()
);

-- ---------- お知らせ(v1.1追加) ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  type text not null check (type in ('number_added','schedule_updated','attendance_updated')),
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.notifications (user_id, created_at desc);

-- ナンバー追加時に本人へお知らせを自動生成
create or replace function public.notify_number_added()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title)
  select new.user_id, 'number_added',
         'ナンバー「' || n.name || '」に追加されました'
  from public.numbers n where n.id = new.number_id
    and new.user_id <> n.owner_id;   -- 作成者本人には出さない
  return new;
end $$;
create trigger trg_notify_number_added
after insert on public.number_members
for each row execute function public.notify_number_added();

-- ---------- 出欠(v1.2追加) ----------
create table public.attendances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot_id uuid references public.slots(id) on delete cascade,          -- 公式練の出欠
  number_event_id uuid references public.number_events(id) on delete cascade, -- ナンバー練の出欠
  status text not null check (status in ('absent','late','leave_early')),
  time_value time,   -- late=到着予定時刻 / leave_early=退出予定時刻
  updated_at timestamptz not null default now(),
  check (num_nonnulls(slot_id, number_event_id) = 1),
  check (status = 'absent' or time_value is not null),
  unique (user_id, slot_id),
  unique (user_id, number_event_id)
);
-- 行が無い人=「出席」扱い(デフォルト行は作らない)

-- 出欠変更をメンバーへお知らせ(本人以外)
create or replace function public.notify_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_label text;
begin
  select username into v_name from public.profiles where user_id = new.user_id;
  v_label := case new.status
             when 'absent' then '欠席'
             when 'late'   then '遅刻(' || to_char(new.time_value,'HH24:MI') || ')'
             else               '早退(' || to_char(new.time_value,'HH24:MI') || ')' end;

  if new.number_event_id is not null then
    insert into public.notifications (user_id, type, title)
    select m.user_id, 'attendance_updated',
           v_name || 'が' || to_char(e.date,'MM/DD') || 'の「' || n.name || '」を' || v_label || 'にしました'
    from public.number_events e
    join public.numbers n on n.id = e.number_id
    join public.number_members m on m.number_id = e.number_id
    where e.id = new.number_event_id and m.user_id <> new.user_id;
  else
    insert into public.notifications (user_id, type, title)
    select p.user_id, 'attendance_updated',
           v_name || 'が' || to_char(s.date,'MM/DD') || 'の' || g.code || '公式練を' || v_label || 'にしました'
    from public.slots s
    join public.genres g on g.id = s.genre_id
    join public.profiles p on (p.main_genre_id = s.genre_id
         or exists (select 1 from public.user_subgenres ug
                    where ug.user_id = p.user_id and ug.genre_id = s.genre_id))
    where s.id = new.slot_id
      and (s.target_generations is null or p.generation = any(s.target_generations))
      and p.user_id <> new.user_id
      and p.role <> 'ob';   -- OBには公式練の通知を送らない
  end if;
  return new;
end $$;
create trigger trg_notify_attendance
after insert or update on public.attendances
for each row execute function public.notify_attendance();

-- ---------- 今日の施錠状況ボード(v1.5追加) ----------
-- 各練習場所の「鍵が開いているか」を全員で共有する掲示板。
-- 予約(reservations)や申請(claims)とは独立した、その日限りの手動ステータス。
create table public.room_status (
  date date not null,
  room_id smallint not null references public.rooms(id),
  is_unlocked boolean not null,           -- true=開錠済(○) / false=施錠中(×)
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  primary key (date, room_id)
);
-- 行が存在しない = 未設定。UI上は「×(施錠中)」を既定表示とする。
-- 日付をキーに含むため、日付が変わると自動的に×へ戻る(夜間は施錠されている実態と一致。リセット処理不要)。

-- ---------- 管理操作の監査ログ(v1.4追加) ----------
create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(user_id),
  target_user_id uuid references public.profiles(user_id) on delete set null,
  action text not null,                    -- 'update_profile' / 'reset_password' / 'delete_user' 等
  detail jsonb,                            -- {before:{...}, after:{...}}
  created_at timestamptz not null default now()
);
-- 参照はadminのみ。書込はサーバー(service role)のみ

-- ---------- 設定(合言葉ハッシュ等) ----------
create table public.app_settings (
  key text primary key,                    -- 'signup_pass' / 'coordinator_pass' / 'admin_pass'
  value_hash text not null,                -- bcrypt
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 権限 (GRANT)
-- Supabase の既定権限に依存せず、このマイグレーション単体で完結させる。
--
-- 二段構えになっている点に注意:
--   GRANT  = 「テーブルに触れるか」というテーブル単位の許可
--   RLS    = 「どの行に触れるか」という行単位の許可
-- authenticated には GRANT を広めに与え、**実際の可否は RLS ポリシーで決める**
-- (Supabase の標準的な設計)。ポリシーを持たないテーブル
-- (app_settings / calendar_tokens) は RLS が全拒否するため、
-- GRANT があってもクライアントからは一切読めない。
-- =========================================================
grant usage on schema public to anon, authenticated, service_role;

-- service_role: サーバー専用。RLS をバイパスして全操作できる
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- authenticated: ログイン済みユーザー。行の可否は RLS が決める
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- anon(未ログイン)にはテーブル権限を与えない。
-- 認証不要なのは購読ics (§8.6) だけで、そこは service_role で処理するため。

-- 今後このスキーマに追加するテーブルにも同じ権限が付くようにしておく
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- =========================================================
-- RLS ヘルパー
-- 参照先テーブルが揃ってから作る必要があるため、ここに置く(冒頭の注記を参照)
-- =========================================================
-- ログインユーザーのロール取得(RLS内で使用)
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

-- ナンバーのメンバー判定(RLS再帰回避のため security definer)
create or replace function public.is_number_member(p_number uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.number_members
    where number_id = p_number and user_id = p_user
  )
$$;

-- =========================================================
-- RLS
-- =========================================================
alter table public.genres          enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_aliases    enable row level security;
alter table public.profiles        enable row level security;
alter table public.user_subgenres  enable row level security;
alter table public.import_files    enable row level security;
alter table public.reservations    enable row level security;
alter table public.slots           enable row level security;
alter table public.claims          enable row level security;
alter table public.numbers         enable row level security;
alter table public.number_members  enable row level security;
alter table public.number_events   enable row level security;
alter table public.notifications   enable row level security;
alter table public.attendances     enable row level security;
alter table public.room_status     enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.calendar_tokens enable row level security;  -- ポリシー無し=クライアント全拒否
alter table public.app_settings    enable row level security;  -- 同上(service roleのみ)

-- マスタ: ログイン者は読み取り可
create policy sel_genres on public.genres  for select to authenticated using (true);
create policy sel_rooms  on public.rooms   for select to authenticated using (true);
create policy sel_alias  on public.room_aliases for select to authenticated
  using (public.app_role() in ('coordinator','admin'));
create policy ins_alias  on public.room_aliases for insert to authenticated
  with check (public.app_role() in ('coordinator','admin'));

-- profiles: 名簿として全員読める。更新は本人(display_nameのみ列権限で許可)
create policy sel_profiles on public.profiles for select to authenticated using (true);
create policy upd_profiles on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.profiles from authenticated;
grant  update (display_name) on public.profiles to authenticated;
-- insert/delete/role変更はservice role(API)経由のみ

-- user_subgenres: 読みは全員、書きは本人
create policy sel_subg on public.user_subgenres for select to authenticated using (true);
create policy mod_subg on public.user_subgenres for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- import_files / reservations: 折衝以上のみ
create policy all_imports on public.import_files for all to authenticated
  using (public.app_role() in ('coordinator','admin'))
  with check (public.app_role() in ('coordinator','admin'));
create policy all_resv on public.reservations for all to authenticated
  using (public.app_role() in ('coordinator','admin'))
  with check (public.app_role() in ('coordinator','admin'));

-- slots: 公開済は現役のみ閲覧可(OBは公式練を見られない) / 下書き含む全操作は折衝以上
create policy sel_slots_pub on public.slots for select to authenticated
  using (
    (published = true and public.app_role() <> 'ob')
    or public.app_role() in ('coordinator','admin')
  );
create policy mod_slots on public.slots
  for all to authenticated
  using (public.app_role() in ('coordinator','admin'))
  with check (public.app_role() in ('coordinator','admin'));

-- claims: 全員閲覧可(全体カレンダーに表示するため)。
-- 申請は本人のみ・公開済openコマのみ。取消は本人 or 折衝以上。
create policy sel_claims on public.claims for select to authenticated
  using (public.app_role() <> 'ob');
create policy ins_claims on public.claims for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.app_role() <> 'ob'
    and exists (select 1 from public.slots s
                where s.id = slot_id and s.published and s.status = 'open'
                  and s.start_time <= claims.start_time
                  and claims.end_time <= s.end_time)
  );
create policy del_claims on public.claims for delete to authenticated
  using (user_id = auth.uid() or public.app_role() in ('coordinator','admin'));

-- attendances: 公式練分は全員閲覧可 / ナンバー練分はメンバーのみ。書込は本人かつ参加者のみ
create policy sel_att on public.attendances for select to authenticated
  using (
    slot_id is not null
    or exists (select 1 from public.number_events e
               where e.id = number_event_id
                 and public.is_number_member(e.number_id, auth.uid()))
  );
create policy mod_att on public.attendances for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      (slot_id is not null and public.app_role() <> 'ob' and exists (
         select 1 from public.slots s
         where s.id = slot_id and s.published and s.status = 'genre'
           and (s.genre_id = (select main_genre_id from public.profiles p where p.user_id = auth.uid())
                or s.genre_id in (select genre_id from public.user_subgenres g where g.user_id = auth.uid()))
           and (s.target_generations is null
                or (select generation from public.profiles p where p.user_id = auth.uid())
                   = any(s.target_generations))))
      or
      (number_event_id is not null and exists (
         select 1 from public.number_events e
         where e.id = number_event_id
           and public.is_number_member(e.number_id, auth.uid())))
    )
  );

-- room_status: 全員が閲覧・切替可(鍵を開けた人/閉めた人が誰でも更新できる仕様)。
-- ただし updated_by は必ず本人(なりすまし防止)、変更できるのは当日分のみ。
create policy sel_rstatus on public.room_status for select to authenticated
  using (public.app_role() <> 'ob');
create policy ins_rstatus on public.room_status for insert to authenticated
  with check (updated_by = auth.uid() and public.app_role() <> 'ob'
              and date = (now() at time zone 'Asia/Tokyo')::date);
create policy upd_rstatus on public.room_status for update to authenticated
  using (date = (now() at time zone 'Asia/Tokyo')::date and public.app_role() <> 'ob')
  with check (updated_by = auth.uid() and public.app_role() <> 'ob'
              and date = (now() at time zone 'Asia/Tokyo')::date);

-- admin_audit_logs: adminのみ閲覧。書込はservice roleのみ(ポリシー無し)
create policy sel_audit on public.admin_audit_logs for select to authenticated
  using (public.app_role() = 'admin');

-- notifications: 本人のみ閲覧・既読化。生成はトリガ/サーバーのみ
create policy sel_notif on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy upd_notif on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- numbers系: メンバーのみ存在を知れる
create policy sel_numbers on public.numbers for select to authenticated
  using (public.is_number_member(id, auth.uid()));
create policy ins_numbers on public.numbers for insert to authenticated
  with check (owner_id = auth.uid());
create policy mod_numbers on public.numbers for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy del_numbers on public.numbers for delete to authenticated
  using (owner_id = auth.uid() or public.app_role() = 'admin');

create policy sel_nmembers on public.number_members for select to authenticated
  using (public.is_number_member(number_id, auth.uid()));
create policy ins_nmembers on public.number_members for insert to authenticated
  with check (exists (select 1 from public.numbers n
                      where n.id = number_id and n.owner_id = auth.uid()));
create policy del_nmembers on public.number_members for delete to authenticated
  using (
    user_id = auth.uid()  -- 自主脱退
    or exists (select 1 from public.numbers n
               where n.id = number_id and n.owner_id = auth.uid())
  );

create policy sel_nevents on public.number_events for select to authenticated
  using (public.is_number_member(number_id, auth.uid()));
create policy mod_nevents on public.number_events for all to authenticated
  using (exists (select 1 from public.numbers n
                 where n.id = number_id and n.owner_id = auth.uid()))
  with check (exists (select 1 from public.numbers n
                      where n.id = number_id and n.owner_id = auth.uid()));

-- =========================================================
-- シード
-- =========================================================
insert into public.genres (id, code, sort_order) values
 (1,'BREAK',1),(2,'HIPHOP',2),(3,'POP',3),(4,'LOCK',4),(5,'JAZZ',5),
 (6,'HOUSE',6),(7,'PUNKING',7),(8,'KRUMP',8),(9,'GIRLS',9);

insert into public.rooms (id, name, section, sort_order) values
 (1,'スタジオ101(7号館)','7号館',1),
 (2,'練習室1(フレスコ)','フレスコ',2),
 (3,'練習室2(フレスコ)','フレスコ',3),
 (4,'展示・多目的室(フレスコ)','フレスコ',4),
 (5,'リハーサル室','講堂',5),
 (6,'控室136','講堂',6),
 (7,'控室132','講堂',7),
 (8,'控室131','講堂',8),
 (9,'アリーナA','アリーナ',9),
 (10,'アリーナB','アリーナ',10),
 (11,'アリーナC','アリーナ',11),
 (12,'剣道場(体育館)','アリーナ',12);

insert into public.room_aliases (alias, room_id) values
 ('スタジオ101',1),
 ('第1練習室',2),('第2練習室',3),
 ('展示・多目的室(全面)',4),('展示・多目的室',4),
 ('リハーサル室',5),('控室136',6),('控室132',7),('控室131',8),
 ('アリーナA',9),('アリーナB',10),('アリーナC',11),('剣道場',12);
