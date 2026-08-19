-- =========================================================
-- 0007_club_key_holders.sql
-- SPEC.md v1.12 の差分。部室の鍵の所持者ボード (§6.1.2)。
--
-- 0001〜0006 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- 部室の鍵を今持っている人 ----------
-- 部室の鍵は1本しかなく、手渡しで回っている。
-- 「今どこにあるか」が分からないと部室が開けられないため、
-- 受け取った人がボタンを押して所持者を更新する。
--
-- **1行だけを更新するのではなく、受け渡しのたびに1行足す。**
--   - 現在の所持者 = taken_at が最新の行
--   - 誰から誰へ渡ったかが残るので、行方が分からなくなったとき
--     「最後に持っていた人」から順にたどれる
--   - 更新の競合 (2人が同時に押す) を考えなくてよい
--
-- 施錠状況ボード (room_status) と違い**日付でリセットしない**。
-- 鍵は日をまたいで同じ人が持っているのが普通のため。
create table public.club_key_holders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  taken_at timestamptz not null default now()
);

-- 現在の所持者を引くクエリ (order by taken_at desc limit 1) のため
create index club_key_holders_taken_at_idx
  on public.club_key_holders (taken_at desc);

alter table public.club_key_holders enable row level security;

grant select, insert on public.club_key_holders to authenticated;
grant all privileges on public.club_key_holders to service_role;

-- 閲覧は現役全員。OB は部室の鍵に関わらない (タブ①自体が見えない。§3.6)
create policy sel_key on public.club_key_holders for select to authenticated
  using (public.app_role() <> 'ob');

-- **自分が持っていることしか宣言できない** (なりすまし防止)。
-- room_status の updated_by と同じ考え方 (§6.1.1)
create policy ins_key on public.club_key_holders for insert to authenticated
  with check (user_id = auth.uid() and public.app_role() <> 'ob');

-- 更新・削除のポリシーは置かない = 誰も書き換えられない。
-- 押し間違えたときは正しい人がもう一度押せばよく、
-- 履歴を消せるようにする理由が無い。
