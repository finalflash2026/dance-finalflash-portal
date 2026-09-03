-- =========================================================
-- 0015_board_messages.sql
-- SPEC.md v1.27 の差分。掲示板の連絡欄 (§6.1.3)。
--
-- 0001〜0014 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- 連絡 ----------
-- 施錠状況ボード (§6.1.1) と部室の鍵ボード (§6.1.2) に、短いやり取りを足す。
--
-- ○×だけでは表せない状況があるため:
--   「控室136は開けていないが、鍵はリハーサル室にいる人が持っている」
--
-- **書き換えではなく足していく。** 上のような話は「持ってます」→
-- 「取りに行きます」→「渡しました」と続くのが自然で、1行を上書きする形だと
-- 途中が消える。部室の鍵の受け渡し (club_key_holders) と同じ考え方。
create table public.board_messages (
  id uuid primary key default gen_random_uuid(),
  -- どちらのボードの連絡か
  scope text not null check (scope in ('room', 'club_key')),
  -- **施錠状況は日付でリセットされる**ので、連絡も日付に紐づける。
  -- 部室の鍵は日をまたいで続くため日付を持たない (§6.1.2)
  date date,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now(),
  constraint board_messages_scope_date check (
    (scope = 'room' and date is not null)
    or (scope = 'club_key' and date is null)
  )
);

-- 「このボードの新しい順」で引く
create index board_messages_scope_idx
  on public.board_messages (scope, date, created_at desc);

alter table public.board_messages enable row level security;

grant select, insert, delete on public.board_messages to authenticated;
grant all privileges on public.board_messages to service_role;

-- 閲覧・書き込みは現役全員。OB はどちらのボードも見られない (§3.6)
create policy sel_bmsg on public.board_messages for select to authenticated
  using (public.app_role() <> 'ob');

create policy ins_bmsg on public.board_messages for insert to authenticated
  with check (user_id = auth.uid() and public.app_role() <> 'ob');

-- **消せるのは書いた本人だけ。** 他人の発言を消せると、
-- 何が話されていたのか誰にも分からなくなる。
-- 更新のポリシーは置かない = 書き換えられない (言った内容が後から変わらない)
create policy del_bmsg on public.board_messages for delete to authenticated
  using (user_id = auth.uid());

-- ---------- 通知のカテゴリを1つ足す ----------
-- 鍵の開閉とは別に切れるようにする。**連絡は数が多くなりうる**ので、
-- まとめて1つにすると「うるさいから鍵の通知ごと切る」が起きる (§6.6)。
alter table public.push_subscriptions
  add column if not exists notify_message boolean not null default true;
