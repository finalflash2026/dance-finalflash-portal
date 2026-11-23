import { after } from "next/server";

import { getCurrentProfile } from "@/lib/auth/session";
import { canWrite } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { activeMemberIds, sendPush } from "@/lib/push";
import { NOTIFY_DELAY_MS, UNDO_ACCEPT_MS, sleep } from "@/lib/key-undo";
import { createAdminClient } from "@/lib/supabase/admin";
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
// 通知は取り消しを待ってから送る (v1.50.4)
export const maxDuration = 30;

export async function POST() {
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

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("club_key_holders")
    .insert({ user_id: profile.user_id })
    .select("id")
    .single();

  if (error) {
    return Response.json(
      { error: `登録できませんでした: ${error.message}` },
      { status: 403 },
    );
  }

  // 取り消しを待ってから送る (v1.50.4)。取り消されて行が消えていたら送らない
  after(async () => {
    await sleep(NOTIFY_DELAY_MS);
    // 応答のあとはリクエストのクッキーを読めないので、読むだけ service role で行う
    const { data: still } = await createAdminClient()
      .from("club_key_holders")
      .select("id")
      .eq("id", inserted.id)
      .maybeSingle();
    if (!still) return;
    const recipients = await activeMemberIds(profile.user_id);
    await sendPush({
      category: "key",
      userIds: recipients,
      payload: {
        // 施錠の通知と同じ形に揃える (v1.26)。1行目に誰が、2行目に何を
        title: profile.username,
        body: "部室の鍵を持っています",
        url: "/",
        // 所持者は1人なので、常に最新の1件だけ残ればよい
        tag: "club-key",
      },
    });
  });

  return Response.json({ ok: true });
}

/**
 * DELETE /api/club-key/claim  (SPEC §6.1.2 / v1.50.4)
 *
 * 押し間違えた「自分が受け取った」を取り消す。**自分が UNDO_ACCEPT_MS 以内に足した、
 * いちばん新しい行だけ**を消して、前の所持者に戻す。club_key_holders には削除の
 * RLS が無い (履歴を消させないため) ので、ここで条件を確かめてから service role で消す。
 */
export async function DELETE() {
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

  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("club_key_holders")
    .select("id, user_id, taken_at")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const mine =
    latest?.user_id === profile.user_id &&
    Date.now() - new Date(latest.taken_at as string).getTime() <= UNDO_ACCEPT_MS;
  if (!latest || !mine) {
    return Response.json(
      { error: "取り消せる時間を過ぎました。" },
      { status: 409 },
    );
  }

  const { error } = await createAdminClient()
    .from("club_key_holders")
    .delete()
    .eq("id", latest.id);
  if (error) {
    return Response.json({ error: "取り消せませんでした。" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
