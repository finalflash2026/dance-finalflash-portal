import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/logout  (SPEC.md §6.4.1)
 *
 * cookie のセッションを破棄する。呼び出し側は成功後に /login へ遷移する。
 */
export const runtime = "nodejs";

export async function POST() {
  if (!hasSupabaseEnv()) {
    return Response.json({ ok: true });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}
