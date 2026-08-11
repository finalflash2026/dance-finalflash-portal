import "server-only";

import { cache } from "react";

import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * ログイン中のユーザーの profiles 行を取得する (SPEC.md §3.1)
 *
 * ロールによる画面の出し分け (タブバーの構成・OB のリダイレクト) に使う。
 * **認可の最終防衛線は RLS であり、これは補助**という位置づけ (SPEC §13.2)。
 *
 * React の cache() で包んでいるため、1リクエスト内で何度呼んでも DB クエリは1回。
 * Supabase 未設定時 (セットアップ前) は null を返す。
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  if (!hasSupabaseEnv()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return (data as Profile | null) ?? null;
});
