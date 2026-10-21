-- =========================================================
-- 0019_rate_limits.sql
-- SPEC.md v1.31.4 の差分。ログイン・登録・権限追加の試行回数を DB で数える (§13.2)。
--
-- 0001〜0018 適用済みの環境に対して追加で流す。
-- =========================================================

-- 以前はサーバーのメモリで数えていたが、Vercel はサーバーを複数・使い捨てで
-- 動かすため、実際にはほぼ効いていなかった。合言葉は全員共通なので、
-- 総当たりされると特に困る。DB に置けば、どのサーバーからでも同じ数を見る。
--
-- key には IP やユーザーIDを**そのまま入れず**、サーバーで SHA-256 にした値を入れる。
create table public.rate_limits (
  key text primary key,
  count integer not null,
  reset_at timestamptz not null
);

-- 期限切れの行を消すときに使う
create index rate_limits_reset_idx on public.rate_limits (reset_at);

alter table public.rate_limits enable row level security;
-- ポリシーは置かない = ログイン中のユーザーからは読めも書けもしない。
-- 触れるのはサーバー (service role) だけ
grant all privileges on public.rate_limits to service_role;

/**
 * 1回数えて、上限以内なら true を返す。
 *
 * **1回の SQL で数えて判定する** (読んでから書くと、同時に来た試行が
 * 両方とも「まだ上限未満」と読んですり抜ける)。窓が過ぎていたら数え直す。
 */
create or replace function public.hit_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case when r.reset_at <= now() then 1 else r.count + 1 end,
        reset_at = case when r.reset_at <= now()
                        then now() + make_interval(secs => p_window_seconds)
                        else r.reset_at end
  returning count into v_count;

  -- たまに期限切れの行を片付ける (表が育ち続けないように)
  if random() < 0.01 then
    delete from public.rate_limits where reset_at < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end
$$;

-- サーバー (service role) からだけ呼べる。ログイン前の人 (anon) には呼ばせない
-- (Supabase は public スキーマの関数に anon / authenticated の実行権を既定で付けるので、明示的に外す)
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
