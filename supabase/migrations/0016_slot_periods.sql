-- =========================================================
-- 0016_slot_periods.sql
-- SPEC.md v1.28 の差分。コマ割り表の「コマの時間」を持つ (§6.2 Step2)。
--
-- 0001〜0015 適用済みの環境に対して追加で流す。
-- =========================================================

-- 折衝係は毎月、その月の基準になるコマの時間を決めてから場所を割り振る。
-- これまでは Excel の中にしかなく、サイト側は1コマずつ手で時刻を打っていた。
--
-- **月ごとに持つ。** 学期や施設の都合で毎月変わりうるうえ、
-- 過去の月を開いたときに当時の区切りで表示できる必要があるため。
--
-- **所在 (section) ごとに上書きできる。** まれに特定の練習場所だけ
-- 基準からズレる (折衝係の Excel でも建物ごとに時間割の列が分かれている)。
-- 上書きが無ければ基準をそのまま使う。
create table public.slot_periods (
  -- その月の1日
  month date not null,
  -- '' = 全体の基準 / 'アリーナ' 等 = その所在だけの上書き。
  -- **null を「基準」に使わない。** 一意制約で null 同士は別物と扱われ、
  -- 基準の行を何本でも作れてしまうため
  section text not null default '',
  position smallint not null check (position between 1 and 12),
  start_time time not null,
  end_time time not null,
  primary key (month, section, position),
  check (start_time < end_time)
);

alter table public.slot_periods enable row level security;

grant select, insert, update, delete on public.slot_periods to authenticated;
grant all privileges on public.slot_periods to service_role;

-- 中身は時刻だけで隠すものが無いので、閲覧は現役全員に開けておく。
-- 書き込みは折衝以上 (コマ割りの前提になる値で、崩れると表全体がズレる)
create policy sel_speriod on public.slot_periods for select to authenticated
  using (true);

create policy mod_speriod on public.slot_periods for all to authenticated
  using (public.app_role() in ('coordinator', 'admin'))
  with check (public.app_role() in ('coordinator', 'admin'));
