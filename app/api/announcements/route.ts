import { after } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { sendPush } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/announcements  (SPEC.md §6.7.4 / §8.13 / v1.30)
 *
 * 3役からの全体告知。**admin だけ**。
 *
 * 全員のお知らせに入れて、通知も飛ばす。ブラウザから直接 insert させると
 * **送っていない告知を全員へ届けられてしまう**ので、サーバーで権限を
 * 確かめてから service role で書く (§6.6 / §8.12 と同じ理由)。
 */
export const runtime = "nodejs";

const schema = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(1000),
  includeOb: z.boolean(),
});

export async function POST(request: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof Response) return guard;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "タイトル (60文字まで) と本文 (1000文字まで) を入れてください" },
      { status: 400 },
    );
  }
  const { title, body, includeOb } = parsed.data;

  const admin = createAdminClient();
  const { data: announcement, error } = await admin
    .from("announcements")
    .insert({ title, body, include_ob: includeOb, created_by: guard.user_id })
    .select("id")
    .single();

  if (error || !announcement) {
    return Response.json(
      { error: `送れませんでした: ${error?.message ?? "不明なエラー"}` },
      { status: 500 },
    );
  }

  let recipientQuery = admin.from("profiles").select("user_id");
  if (!includeOb) recipientQuery = recipientQuery.neq("role", "ob");
  const { data: recipients, error: recipientError } = await recipientQuery;
  if (recipientError) {
    return Response.json(
      { error: `宛先を引けませんでした: ${recipientError.message}` },
      { status: 500 },
    );
  }
  const userIds = (recipients ?? []).map(
    (row) => (row as { user_id: string }).user_id,
  );

  // **送った本人のお知らせにも入れる。** 告知は「誰かの操作の通知」ではなく
  // 全員が読む掲示なので、送り手にも同じものが見えていたほうが確かめやすい
  const { error: notifyError } = await admin.from("notifications").insert(
    userIds.map((userId) => ({
      user_id: userId,
      type: "announcement",
      title,
      body,
      announcement_id: announcement.id,
    })),
  );
  if (notifyError) {
    // お知らせが入らない告知は意味が無いので、告知ごと取り消して失敗を返す
    await admin.from("announcements").delete().eq("id", announcement.id);
    return Response.json(
      { error: `お知らせを作れませんでした: ${notifyError.message}` },
      { status: 500 },
    );
  }

  // 通知は応答を返してから送る。中身はロック画面に出るので見出しだけ (§6.6)
  after(async () => {
    await sendPush({
      category: "announcement",
      userIds: userIds.filter((id) => id !== guard.user_id),
      payload: {
        title: "3役からの告知",
        body: title,
        url: "/",
        tag: `announcement-${announcement.id}`,
      },
    });
  });

  return Response.json({ ok: true, recipients: userIds.length });
}
