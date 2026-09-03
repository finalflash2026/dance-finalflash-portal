-- =========================================================
-- 0012_genre_practices.sql
-- SPEC.md v1.23 の差分。スタ練 (ジャンル単位の自主練) (§6.3.1)。
--
-- 0001〜0011 適用済みの環境に対して追加で流す。
-- =========================================================

-- ---------- スタ練 ----------
-- 公式練とは別に、ジャンルの有志がスタジオを取って行う練習。
--
-- **ナンバーと違ってメンバーを選ばない。** そのジャンルを取っている人
-- 全員に自動で共有される。誰が来るかを事前に決める性質のものではなく、
-- 名簿を作らせると「入れ忘れた人に伝わらない」が起きるため。
--
-- 公式練 (slots) と同じ扱いにする理由:
--   - マイカレンダーでは「{ジャンル}スタ練」として**公式練と同じ色**で出す
--   - 絞り込みも公式練と同じキー (BREAK を押せば公式練とスタ練の両方)
-- 利用者から見れば「BREAKの練習」であって、主催が公式かどうかは
-- 予定を探すときの関心事ではない。
create table public.genre_practices (
  id uuid primary key default gen_random_uuid(),
  genre_id smallint not null references public.genres(id),
  date date not null,
  start_time time not null,
  end_time time not null,
  place text not null,                     -- 自由記入 (レンタルスタジオ名等)
  note text,
  created_by uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 日跨ぎ対応 (v1.21 と同じ約束)。終了が開始以前なら翌日まで。
  -- 同じ時刻だけは 0分か24時間か決めようがないので禁じる
  check (start_time <> end_time)
);

-- マイカレンダーは「自分のジャンル × その月」で引く
create index genre_practices_genre_date_idx
  on public.genre_practices (genre_id, date);

-- ---------- 1ジャンの判定 ----------
-- **設定できるのは自分の1ジャンだけ**なので、RLS から引けるようにする。
-- app_role() と同じく security definer (profiles の RLS と再帰しないため)。
create or replace function public.app_main_genre()
returns smallint language sql stable security definer set search_path = public as $$
  select main_genre_id from public.profiles where user_id = auth.uid()
$$;

alter table public.genre_practices enable row level security;

grant select, insert, update, delete on public.genre_practices to authenticated;
grant all privileges on public.genre_practices to service_role;

-- 閲覧は現役全員。ジャンルでの絞り込みはアプリ側 (マイカレンダー) が行う。
-- **RLS で自分のジャンルだけに絞らない** — 公式練 (sel_slots) と同じ方針で、
-- 「他のジャンルが何をしているか」は隠す情報ではないため。
-- OB は公式練を見られないので、こちらも見せない (§3.6)。
create policy sel_gpractice on public.genre_practices for select to authenticated
  using (public.app_role() <> 'ob');

-- **作れるのは自分の1ジャンのぶんだけ。** 他ジャンルの予定を勝手に立てられると、
-- そのジャンルの人には出所の分からない予定が届く。
create policy ins_gpractice on public.genre_practices for insert to authenticated
  with check (
    created_by = auth.uid()
    and genre_id = public.app_main_genre()
    and public.app_role() <> 'ob'
  );

-- 直せるのは登録した本人だけ。同じジャンルの他の人にも触らせない
-- (空き申請の取消と同じ考え方。§6.1 / v1.22)
create policy upd_gpractice on public.genre_practices for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and genre_id = public.app_main_genre());

create policy del_gpractice on public.genre_practices for delete to authenticated
  using (created_by = auth.uid());
