import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseEnv } from "@/lib/env";
import { createDemoClient } from "@/lib/supabase/demo-client";

/**
 * ブラウザ用 Supabase クライアント (SPEC §2 / §13.2)。
 * RLS の範囲内での読み書きにのみ使う。service role は絶対に使わない。
 *
 * Supabase が未設定の手元の環境では、デモ画面 (`/demo`) のために
 * 何もしないダミーを返す (lib/supabase/demo-client.ts)。
 */
export function createClient(): SupabaseClient {
  if (!hasSupabaseEnv()) {
    return createDemoClient() as SupabaseClient;
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
