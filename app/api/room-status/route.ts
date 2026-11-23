import { after } from "next/server";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/session";
import { canWrite } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { activeMemberIds, sendPush } from "@/lib/push";
import { fetchRoomMap } from "@/lib/rooms-server";
import { NOTIFY_DELAY_MS, UNDO_ACCEPT_MS, sleep } from "@/lib/key-undo";
import { isMissingRelation } from "@/lib/schema-errors";
import { createAdminClient } from "@/lib/supabase/admin";
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
// 通知は取り消しを待ってから送る (v1.50.4)。応答のあとに約10秒待つので、短すぎない上限にする
export const maxDuration = 30;

const schema = z.object({
  roomId: z.number().int(),
  isUnlocked: z.boolean(),
  /**
   * 押し間違いの取り消し (v1.50.4)。自分が UNDO_ACCEPT_MS 以内に変えた部屋だけ戻せる。
   * **通知は送らない** (取り消した報告の通知は、待っているあいだに止まる)
   */
  undo: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です(Supabase 未接続)。" },
      { status: 503 },
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }
  // 閲覧のみ (v1.30) は書けない。RLS でも止まるが、ここで弾けば
  // 「permission denied」ではなく理由の分かる日本語を返せる (§13.2)
  if (!canWrite(profile.role)) {
    return Response.json(
      { error: "閲覧のみのアカウントでは操作できません" },
      { status: 403 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "指定が不正です。" }, { status: 400 });
  }

  const supabase = await createClient();
  const room = (await fetchRoomMap(supabase)).get(parsed.data.roomId);
  if (!room) {
    return Response.json({ error: "その練習場所はありません。" }, { status: 400 });
  }

  const today = todayInTokyo();

  if (parsed.data.undo) {
    const { data: current } = await supabase
      .from("room_status")
      .select("updated_by, updated_at")
      .eq("date", today)
      .eq("room_id", room.id)
      .maybeSingle();
    const mine =
      current?.updated_by === profile.user_id &&
      Date.now() - new Date(current.updated_at as string).getTime() <= UNDO_ACCEPT_MS;
    if (!mine) {
      return Response.json(
        { error: "取り消せる時間を過ぎました。もう一度報告してください。" },
        { status: 409 },
      );
    }
  }

  const { data: written, error } = await supabase.from("room_status").upsert(
    {
      date: today,
      room_id: room.id,
      is_unlocked: parsed.data.isUnlocked,
      updated_by: profile.user_id,
    },
    { onConflict: "date,room_id" },
  ).select("updated_at").single();

  if (error) {
    return Response.json(
      { error: `切り替えに失敗しました: ${error.message}` },
      { status: 403 },
    );
  }

  if (parsed.data.undo) {
    // 取り消した報告は、開け閉めの記録 (v1.50.4) からも消す。記録は誰も消せない表なので
    // service role で、自分のこの部屋のいちばん新しい1行だけ
    const admin = createAdminClient();
    const { data: log } = await admin
      .from("room_status_logs")
      .select("id, created_at")
      .eq("date", today)
      .eq("room_id", room.id)
      .eq("user_id", profile.user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (log && Date.now() - new Date(log.created_at as string).getTime() <= UNDO_ACCEPT_MS) {
      await admin.from("room_status_logs").delete().eq("id", log.id);
    }
    return Response.json({ ok: true });
  }

  // 開け閉めの記録 (v1.50.4)。表がまだ無い DB (0031 前) では書かずに進む
  const { error: logError } = await supabase.from("room_status_logs").insert({
    date: today,
    room_id: room.id,
    is_unlocked: parsed.data.isUnlocked,
    user_id: profile.user_id,
  });
  if (logError && !isMissingRelation(logError)) {
    console.error("room_status_logs insert failed", logError.message);
  }

  // 応答を返してから送る。150人ぶんの送信を待たせると、
  // 押してから ○ が変わるまでが目に見えて遅くなる。
  // **取り消しを待ってから送る** (v1.50.4)。待つあいだに誰か (取り消した本人を含む) が
  // 変えていたら送らない。その人の報告の通知が代わりに届く
  const writtenAt = written?.updated_at as string | undefined;
  after(async () => {
    await sleep(NOTIFY_DELAY_MS);
    // 応答のあとはリクエストのクッキーを読めないので、読むだけ service role で行う
    const { data: latest } = await createAdminClient()
      .from("room_status")
      .select("updated_at")
      .eq("date", today)
      .eq("room_id", room.id)
      .maybeSingle();
    if (!latest || latest.updated_at !== writtenAt) return;
    const recipients = await activeMemberIds(profile.user_id);
    await sendPush({
      category: "room",
      userIds: recipients,
      payload: {
        /*
         * **1行目に誰が、2行目に何をしたか** (SPEC §6.6 / v1.26)。
         *
         * 以前は1行に収めていたが、ユーザーIDと場所名がどちらも長く、
         * iPhone のロック画面では肝心の「開けました/閉めました」まで
         * 表示されずに切れていた。**通知で一番知りたいのは開いたかどうか**
         * なので、そこを2行目の先頭側に置く。
         */
        title: profile.username,
        body: `${room.name}を${
          parsed.data.isUnlocked ? "開けました" : "閉めました"
        }`,
        url: "/",
        // 同じ部屋の開け閉めは置き換える。往復しても通知が積み上がらない
        tag: `room-${room.id}`,
      },
    });
  });

  return Response.json({ ok: true });
}
