import "server-only";

import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL, requireServiceRoleKey } from "@/lib/env";

/**
 * service role クライアント (SPEC §8 / §13.2)。**RLS を完全にバイパスする**。
 *
 * 冒頭の `import "server-only"` により、誤ってクライアントコンポーネントから
 * import するとビルドが失敗する = 鍵の露出を構造的に防いでいる。
 *
 * 使ってよいのは以下のようなサーバー専用処理のみ:
 *   - 合言葉の照合とユーザー作成 (§8.1)
 *   - 購読トークンからのユーザー特定 (§8.6)
 *   - admin によるユーザー操作 (§8.9)
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL, requireServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
