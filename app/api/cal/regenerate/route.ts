import { getCurrentProfile } from "@/lib/auth/session";
import { generateCalendarToken } from "@/lib/auth/token";
import { hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/cal/regenerate  (SPEC.md §8.7 / §6.4.1)
 *
 * 本人の calendar_tokens を新トークンで置換する。**旧トークンは即無効化**される
 * ため、UI 側は確認ダイアログを必須にする (SPEC §12)。
 *
 * calendar_tokens は RLS ポリシーを持たない = クライアントからは一切触れない
 * (SPEC §5.2)。よって service role 経由で更新する。
 */
export const runtime = "nodejs";

export async function POST() {
  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です (Supabase 未接続)" },
      { status: 503 },
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "ログインしてください" }, { status: 401 });
  }

  const token = generateCalendarToken();
  const admin = createAdminClient();

  const { error } = await admin
    .from("calendar_tokens")
    .upsert({ user_id: profile.user_id, token }, { onConflict: "user_id" });

  if (error) {
    return Response.json(
      { error: `再発行に失敗しました: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.json({ token });
}
