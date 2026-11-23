-- =========================================================
-- 0031_room_status_logs.sql
-- SPEC.md v1.50.4 の差分。練習場所の開け閉めの記録 (§6.1.1)。
--
-- 0001〜0029 適用済みの環境に対して追加で流す。
-- **番号は 0030 を飛ばしている。** サークル側の未公開の 0030 (アカウント削除・端末の
-- 通知の宛先) と重ねないため。0030 とは関係が無いので、どちらを先に流してもよい。
-- =========================================================

-- room_status は「今日の今の状態」を1部屋1行で上書きするだけなので、
-- 誰がいつ開け閉めしたかの流れが残らなかった。報告のたびに1行足す。
create table if not exists public.room_status_logs (
  id bigint generated always as identity primary key,
  date date not null,
  room_id smallint not null references public.rooms(id),
  is_unlocked boolean not null,
  -- 退会した人の記録は残し、名前だけ消える
  user_id uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists room_status_logs_created_idx
  on public.room_status_logs (created_at desc);

alter table public.room_status_logs enable row level security;
grant select, insert on public.room_status_logs to authenticated;
grant all privileges on public.room_status_logs to service_role;

-- 見られるのは room_status と同じく現役 (OB は鍵のボードを持たない。§3.6)
drop policy if exists sel_rslog on public.room_status_logs;
create policy sel_rslog on public.room_status_logs for select to authenticated
  using (public.app_role() is not null and public.app_role() <> 'ob');

-- 書けるのは自分の報告だけ。閲覧のみ・OB は書けない
drop policy if exists ins_rslog on public.room_status_logs;
create policy ins_rslog on public.room_status_logs for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.app_role() not in ('ob', 'viewer')
  );

-- 更新・削除のポリシーは置かない (記録は書き換えられない)。
-- 押し間違いの取り消し (v1.50.4) だけ、サーバーが条件を確かめて service role で消す
