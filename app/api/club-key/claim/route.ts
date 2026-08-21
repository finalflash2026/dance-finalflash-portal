import { after } from "next/server";

import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { activeMemberIds, sendPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/club-key/claim  (SPEC.md §6.1.2 / §6.6)
 *
 * 「私が部室の鍵を持っています」。所持者として1行足す。
 *
 * room-status と同じ理由でサーバー経由にしてある (v1.15)。
 * ブラウザから直接 insert させたままだと、**実際には受け取っていない人が
 * 「◯◯が鍵を持っています」という通知だけを全員に流せてしまう**。
 *
 * 書き込みはセッションのクライアントで行い、RLS の
 * 「自分が持っていることしか宣言できない」条件をそのまま効かせる。
 * 本文に入力は無い (誰が押したかはセッションで決まる)。
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("club_key_holders")
    .insert({ user_id: profile.user_id });

  if (error) {
    return Response.json(
      { error: `登録できませんでした: ${error.message}` },
      { status: 403 },
    );
  }

  after(async () => {
    const recipients = await activeMemberIds(profile.user_id);
    await sendPush({
      category: "key",
      userIds: recipients,
      payload: {
        title: "部室の鍵の所持者が変わりました",
        body: `${profile.username} さんが持っています`,
        url: "/overview",
        // 所持者は1人なので、常に最新の1件だけ残ればよい
        tag: "club-key",
      },
    });
  });

  return Response.json({ ok: true });
}
