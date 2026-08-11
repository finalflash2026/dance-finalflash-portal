import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Server Component / Route Handler 用の Supabase クライアント。
 * セッションは cookie で管理する (@supabase/ssr の標準パターン, SPEC §3.3)。
 *
 * cookies API は getAll / setAll 方式を使う (get/set/remove は非推奨)。
 * Next.js 15 では cookies() が Promise を返すため await が必要。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からは cookie を書けない。
          // セッションの更新は middleware が行っているため無視してよい。
        }
      },
    },
  });
}
