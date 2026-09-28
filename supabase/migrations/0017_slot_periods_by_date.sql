-- =========================================================
-- 0017_slot_periods_by_date.sql
-- SPEC.md v1.29 の差分。コマの時間を「日にち×所在」で持てるようにする (§6.2 Step2)。
--
-- 0001〜0016 適用済みの環境に対して追加で流す。
-- **0016 で作った slot_periods は作り直す** (入っている基準の値は引き継ぐ)。
-- =========================================================

-- 0016 では「月の基準 + 所在ごとの上書き」だけだったが、折衝に確認すると
-- **特定の日にちだけ基準と違う**ことがあると分かった。
-- 折衝係の Excel も、建物ごとの時間割の列が日にちごとに並んでいて、
-- 実態は「日にち×所在」でコマの時間を持っている。
--
-- そこで2段構えにする:
--   slot_period_base      … その月の基準。まずこれを入れる
--   slot_period_overrides … 日にち×所在の上書き。表のセルを直すとここに入る
--
-- **null を混ぜた1枚の表にしない。** 「基準」を null で表すと一意制約で
-- null 同士が別物と扱われ、基準の行を何本でも作れてしまう (0016 で section に
-- '' を使ったのと同じ理由)。日付は '' のような逃げが使えないので表を分ける。

create table public.slot_period_base (
  month date not null,                 -- その月の1日
  position smallint not null check (position between 1 and 12),
  start_time time not null,
  end_time time not null,
  primary key (month, position),
  check (start_time < end_time)
);

create table public.slot_period_overrides (
  date date not null,
  section text not null,               -- '講堂' 'アリーナ' 等。部屋ではなく所在
  position smallint not null check (position between 1 and 12),
  start_time time not null,
  end_time time not null,
  primary key (date, section, position),
  check (start_time < end_time)
);

-- 月ぶんをまとめて引くので、日付で絞れるようにしておく
create index slot_period_overrides_date_idx on public.slot_period_overrides (date);

-- ---------- 0016 の内容を引き継ぐ ----------
-- 基準 (section = '') はそのまま移す。
-- 所在ごとの月全体の上書きは**移さない** — 1日しか存在しておらず、
-- 実際に使われた行は無い (日にち×所在に置き換わる)。
insert into public.slot_period_base (month, position, start_time, end_time)
select month, position, start_time, end_time
  from public.slot_periods
 where section = ''
on conflict do nothing;

drop table public.slot_periods;

-- ---------- 権限 ----------
alter table public.slot_period_base enable row level security;
alter table public.slot_period_overrides enable row level security;

grant select, insert, update, delete on public.slot_period_base to authenticated;
grant select, insert, update, delete on public.slot_period_overrides to authenticated;
grant all privileges on public.slot_period_base to service_role;
grant all privileges on public.slot_period_overrides to service_role;

-- 中身は時刻だけで隠すものが無いので閲覧は全員。
-- 書き込みは折衝以上 (コマ割りの前提になる値で、崩れると表全体がズレる)
create policy sel_speriod_base on public.slot_period_base for select to authenticated
  using (true);
create policy mod_speriod_base on public.slot_period_base for all to authenticated
  using (public.app_role() in ('coordinator', 'admin'))
  with check (public.app_role() in ('coordinator', 'admin'));

create policy sel_speriod_ovr on public.slot_period_overrides for select to authenticated
  using (true);
create policy mod_speriod_ovr on public.slot_period_overrides for all to authenticated
  using (public.app_role() in ('coordinator', 'admin'))
  with check (public.app_role() in ('coordinator', 'admin'));
