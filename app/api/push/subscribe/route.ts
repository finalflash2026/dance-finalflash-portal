import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { isPushConfigured } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/push/subscribe  (SPEC.md §6.6)
 *
 * この端末を通知の届け先として登録する。カテゴリの切り替えも同じ入口で、
 * ブラウザ側の購読は変わらないまま行と列だけ書き換わる。
 *
 * **service role で書く。** endpoint が主キーなので、同じ端末で別の人が
 * ログインし直すと既存の行とぶつかる。RLS 越しだと「他人の行を更新」に
 * なって弾かれ、2人目が通知を登録できない。user_id はセッションから
 * 取ったものを必ず入れるので、他人になりすませはしない。
 */
export const runtime = "nodejs";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  prefs: z
    .object({
      schedule: z.boolean(),
      room: z.boolean(),
      key: z.boolean(),
      message: z.boolean(),
    })
    .optional(),
});

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です (Supabase 未接続)" },
      { status: 503 },
    );
  }
  if (!isPushConfigured()) {
    return Response.json(
      { error: "この環境では通知が設定されていません" },
      { status: 503 },
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "ログインしてください" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "購読の内容が不正です" }, { status: 400 });
  }

  const { endpoint, keys, prefs } = parsed.data;
  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      endpoint,
      user_id: profile.user_id,
      p256dh: keys.p256dh,
      auth: keys.auth,
      notify_schedule: prefs?.schedule ?? true,
      notify_room: prefs?.room ?? true,
      notify_key: prefs?.key ?? true,
      notify_message: prefs?.message ?? true,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return Response.json(
      { error: `通知を登録できませんでした: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
