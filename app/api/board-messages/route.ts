import { after } from "next/server";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { activeMemberIds, sendPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { todayInTokyo } from "@/lib/time";

/**
 * POST /api/board-messages  (SPEC.md §6.1.3 / §6.6)
 *
 * 掲示板 (施錠状況・部室の鍵) の連絡を1件足す。
 *
 * **サーバー経由にしてある理由は鍵の切り替えと同じ** (§6.6)。
 * この操作は全員に通知を出すので、ブラウザから直接 insert させると
 * **書いていない内容を全員に届けられてしまう**。
 *
 * 書き込みは**セッションのクライアント**で行い、RLS の条件
 * (本人名義・OB 不可・文字数) をそのまま効かせる。
 *
 * 削除は通知を伴わないので、画面から RLS 経由で直接消してよい。
 */
export const runtime = "nodejs";

const schema = z.object({
  scope: z.enum(["room", "club_key"]),
  body: z
    .string()
    .trim()
    .min(1, "内容を入力してください")
    .max(300, "300文字以内にしてください"),
});

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
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "内容が不正です" },
      { status: 400 },
    );
  }
  const { scope, body } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("board_messages").insert({
    scope,
    // 施錠状況は日付でリセットされるので連絡も today に紐づける。
    // 部室の鍵は日をまたいで続くため日付を持たない (§6.1.2)
    date: scope === "room" ? todayInTokyo() : null,
    user_id: profile.user_id,
    body,
  });

  if (error) {
    return Response.json(
      { error: `書き込めませんでした: ${error.message}` },
      { status: 403 },
    );
  }

  // 応答を返してから送る。書いた本人を待たせない (§6.6)
  after(async () => {
    const recipients = await activeMemberIds(profile.user_id);
    await sendPush({
      category: "message",
      userIds: recipients,
      payload: {
        // 1行目に誰が、2行目に中身 (v1.26 と同じ形)
        title: profile.username,
        body,
        url: "/overview",
        // 同じボードの連絡はまとめる。連投で通知が積み上がらないように
        tag: `board-${scope}`,
      },
    });
  });

  return Response.json({ ok: true });
}
