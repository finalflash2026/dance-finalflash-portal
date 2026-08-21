import { after } from "next/server";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/session";
import { ROOM_BY_ID } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { activeMemberIds, sendPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { todayInTokyo } from "@/lib/time";

/**
 * POST /api/room-status  (SPEC.md §6.1.1 / §6.6)
 *
 * 「今日の練習場所」の施錠状況を切り替える。
 *
 * **v1.15 でクライアントの直接 upsert からサーバー経由に変えた。**
 * 通知をここから送るためで、ブラウザに送信させると
 * **「開錠しました」を誰でも全員に投げられてしまう**。切り替えの権限は
 * 全員にあるが、**通知を出せるのは実際に切り替えたときだけ**にしたい。
 *
 * **書き込みはセッションのクライアントで行う。** service role にすると
 * RLS の条件 (当日のみ・updated_by は本人・OB 不可) を自前で書き直すことに
 * なり、DB 側の定義と二重管理になる。ここでは RLS をそのまま効かせる
 * (SPEC §13.2)。
 */
export const runtime = "nodejs";

const schema = z.object({
  roomId: z.number().int(),
  isUnlocked: z.boolean(),
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
    return Response.json({ error: "指定が不正です" }, { status: 400 });
  }

  const room = ROOM_BY_ID.get(parsed.data.roomId);
  if (!room) {
    return Response.json({ error: "その練習場所はありません" }, { status: 400 });
  }

  const today = todayInTokyo();
  const supabase = await createClient();
  const { error } = await supabase.from("room_status").upsert(
    {
      date: today,
      room_id: room.id,
      is_unlocked: parsed.data.isUnlocked,
      updated_by: profile.user_id,
    },
    { onConflict: "date,room_id" },
  );

  if (error) {
    return Response.json(
      { error: `切り替えに失敗しました: ${error.message}` },
      { status: 403 },
    );
  }

  // 応答を返してから送る。150人ぶんの送信を待たせると、
  // 押してから ○ が変わるまでが目に見えて遅くなる
  after(async () => {
    const recipients = await activeMemberIds(profile.user_id);
    await sendPush({
      category: "room",
      userIds: recipients,
      payload: {
        // 「誰が」「どこを」「どうした」を1行に収める (SPEC §6.6)
        title: `${profile.username}が${room.name}を${
          parsed.data.isUnlocked ? "開けました" : "閉めました"
        }`,
        url: "/overview",
        // 同じ部屋の開け閉めは置き換える。往復しても通知が積み上がらない
        tag: `room-${room.id}`,
      },
    });
  });

  return Response.json({ ok: true });
}
