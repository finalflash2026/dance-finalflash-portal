import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * ブラウザ用 Supabase クライアント (SPEC §2 / §13.2)。
 * RLS の範囲内での読み書きにのみ使う。service role は絶対に使わない。
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
