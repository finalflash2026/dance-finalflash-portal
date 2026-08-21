-- =========================================================
-- 0008_push_subscriptions.sql
-- SPEC.md v1.15 の差分。プッシュ通知の購読先 (§6.6)。
--
-- 0001〜0007 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- 通知の届け先 ----------
-- Web Push はブラウザが発行する endpoint (URL) 宛に投げる。
-- **端末ごと・ブラウザごとに1つ**で、同じ人が iPhone と PC を使えば2行になる。
--
-- 鍵 (p256dh / auth) は endpoint とセットで初めて意味を持つ。
-- これが無いと本文を暗号化できず送れない。
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  p256dh text not null,
  auth text not null,

  -- **カテゴリ別のオン/オフを端末ごとに持つ。**
  -- 鍵の開閉は「今日予約がある部屋すべて」を現役全員に配るので、
  -- 日によってはかなりの数になる。切る手段が無いと通知そのものを
  -- 切られてしまい、練習日程の公開まで届かなくなる。
  notify_schedule boolean not null default true,  -- 練習日程の公開・更新
  notify_room boolean not null default true,      -- 練習場所の施錠/開錠
  notify_key boolean not null default true,       -- 部室の鍵の所持者

  created_at timestamptz not null default now()
);

-- 配信時は「このユーザーたちの、このカテゴリが有効な購読」を引く
create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all privileges on public.push_subscriptions to service_role;

-- **本人の行しか触れない。** 他人の購読を消せると通知を止められてしまう。
-- 登録そのものはサーバー (service role) 経由で行うが、RLS も同じ条件で
-- 二重に守っておく (SPEC §13.2)。
create policy sel_push on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy ins_push on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
create policy upd_push on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy del_push on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
