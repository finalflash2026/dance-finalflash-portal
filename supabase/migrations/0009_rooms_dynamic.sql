-- =========================================================
-- 0009_rooms_dynamic.sql
-- SPEC.md v1.20 の差分。練習場所を後から増やせるようにする (§4.2 / §6.2)。
--
-- 0001〜0008 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- (a) 新しい練習場所を2つ追加 ----------
-- 柔道場は体育館の中なので、剣道場と同じ「アリーナ」に並べる。
-- 南大沢市民センターは新しい所在なので、section も新設する。
insert into public.rooms (id, name, section, sort_order) values
  (13, '柔道場(体育館)', 'アリーナ', 13),
  (14, '会議室1(南大沢市民センター)', '南大沢市民センター', 14)
on conflict (id) do nothing;

-- 取込CSVで使われそうな表記を別名に登録しておく。
-- ここに無い書かれ方をされても、Step1 の画面から追加できる (§6.2 Step1)。
insert into public.room_aliases (alias, room_id) values
  ('柔道場', 13),
  ('体育館柔道場', 13),
  ('会議室1', 14),
  ('南大沢市民センター会議室1', 14),
  ('市民センター会議室1', 14)
on conflict (alias) do nothing;

-- ---------- (b) id を自動採番にする ----------
-- **これまで id は手で決めていた**(初期データの 1〜12)。
-- 折衝係が画面から練習場所を足せるようにするには、次の番号を
-- DB 側で決められる必要がある。
--
-- `owned by` を付けているので、将来 rooms を落とせば連番も一緒に消える。
create sequence if not exists public.rooms_id_seq owned by public.rooms.id;

-- 既存の最大値まで進めておく。これを忘れると 1 から採番して衝突する
select setval('public.rooms_id_seq', (select max(id) from public.rooms));

alter table public.rooms
  alter column id set default nextval('public.rooms_id_seq')::smallint;

grant usage, select on sequence public.rooms_id_seq to service_role;

-- ---------- (c) 書き込みは service role だけ ----------
-- 練習場所の追加は `POST /api/rooms` が service role で行う。
-- そちらで coordinator 以上を検証している (§8.11)。
--
-- **クライアントに insert を許さない。** 部屋は予約枠・コマ・施錠ボードから
-- 参照される土台のデータで、誰でも増やせると取り違えが起きる。
-- select だけは全員に許可したまま (sel_rooms は 0001 で作成済み)。
grant all privileges on public.rooms to service_role;
grant all privileges on public.room_aliases to service_role;
