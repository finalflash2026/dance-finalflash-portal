import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/push/unsubscribe  (SPEC.md §6.6)
 *
 * この端末への配信を止める。
 *
 * **必ず `user_id` でも絞る。** endpoint だけで消せると、他人の endpoint を
 * 知っている者がその人の通知を止められてしまう。
 */
export const runtime = "nodejs";

const schema = z.object({ endpoint: z.string().url() });

export async function POST(request: Request) {
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

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "解除の内容が不正です" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("user_id", profile.user_id);

  if (error) {
    return Response.json(
      { error: `通知を解除できませんでした: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
