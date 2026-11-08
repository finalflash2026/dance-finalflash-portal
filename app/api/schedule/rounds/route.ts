import { after } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { activeMemberIds, sendPush } from "@/lib/push";
import { loadMonthInput } from "@/lib/scheduling/live";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateLabel, parseDate, todayInTokyo } from "@/lib/time";

/**
 * POST /api/schedule/rounds  (SPEC.md §6.8.5 / v1.44)
 *
 * 日程調整を始める。**折衝・3役だけ**。現役全員のお知らせに入れて通知も送るので、
 * ブラウザから直接書かせずサーバーで権限を確かめてから service role で書く (§13.2)。
 */
export const runtime = "nodejs";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  deadline: date,
});

export async function POST(request: Request) {
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "月と締切の日を入れてください。" }, { status: 400 });
  }
  const { month, deadline } = parsed.data;
  if (deadline < todayInTokyo()) {
    return Response.json({ error: "締切は今日以降の日にしてください。" }, { status: 400 });
  }
  if (deadline >= month) {
    return Response.json({ error: "締切はその月が始まる前の日にしてください。" }, { status: 400 });
  }

  // 予約枠が無い月は、答える候補が無い
  const input = await loadMonthInput(month, null, { onlyUser: guard.user_id });
  if (input.candidates.length === 0) {
    return Response.json(
      { error: "この月の予約枠がまだありません。先に予約の取込をしてください。" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: round, error } = await admin
    .from("schedule_rounds")
    .insert({ month, deadline, created_by: guard.user_id })
    .select("id")
    .single();
  if (error || !round) {
    if (error?.code === "23505") {
      return Response.json({ error: "この月の日程調整はもう始まっています。" }, { status: 409 });
    }
    return Response.json({ error: `始められませんでした: ${error?.message ?? "不明なエラー"}` }, { status: 500 });
  }

  const monthLabel = `${parseDate(month).month}月`;
  const title = `${monthLabel}の日程調整`;
  const body = `出られる日を教えてください。締切 ${formatDateLabel(deadline)}`;
  const recipients = await activeMemberIds();
  if (recipients.length > 0) {
    const { error: notifyError } = await admin.from("notifications").insert(
      recipients.map((userId) => ({ user_id: userId, type: "schedule_round", title, body })),
    );
    if (notifyError) console.error("[schedule] お知らせを作れませんでした", notifyError.message);
  }
  after(async () => {
    await sendPush({
      category: "schedule",
      userIds: recipients.filter((id) => id !== guard.user_id),
      payload: { title, body: `締切 ${formatDateLabel(deadline)}`, url: "/schedule", tag: `round-${round.id}` },
    });
  });

  return Response.json({ ok: true, id: round.id, recipients: recipients.length });
}
