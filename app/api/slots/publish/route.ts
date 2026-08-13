import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { endOfMonth, isValidDateString, parseDate, startOfMonth } from "@/lib/time";

/**
 * POST /api/slots/publish  (SPEC.md §6.2 Step3)
 *
 * 指定した月の下書きコマを一括公開し、**全ユーザーへお知らせを配る**。
 *
 * 権限の使い分けが要点:
 *   - slots の更新は**セッションクライアント**で行う。mod_slots が coordinator
 *     以上を許可しているため足りるし、RLS を最終防衛線として残せる (SPEC §13.2)
 *   - notifications の一括 insert だけは **service role** が要る。
 *     notifications には本人分の select / update ポリシーしか無く、
 *     他人宛の insert はクライアントからは通らないため
 *
 * OB には配らない。OB は公式練を見られないので、届いても開く先が無い (SPEC §3.6)。
 */
export const runtime = "nodejs";

const schema = z.object({
  /** 'YYYY-MM-DD'。月初でなくてもその月として扱う */
  month: z.string(),
});

export async function POST(request: Request) {
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isValidDateString(parsed.data.month)) {
    return Response.json({ error: "月の指定が不正です" }, { status: 400 });
  }

  const monthStart = startOfMonth(parsed.data.month);
  const monthEnd = endOfMonth(parsed.data.month);
  const { year, month } = parseDate(monthStart);

  const supabase = await createClient();

  // 公開**前**に既公開の有無を見る。文言を「公開されました」と
  // 「更新されました」で出し分けるため (SPEC §6.2 Step3)
  const { count: alreadyPublished, error: countError } = await supabase
    .from("slots")
    .select("id", { count: "exact", head: true })
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .eq("published", true);

  if (countError) {
    return Response.json(
      { error: `コマを確認できませんでした: ${countError.message}` },
      { status: 503 },
    );
  }

  const { data: publishedRows, error: publishError } = await supabase
    .from("slots")
    .update({ published: true })
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .eq("published", false)
    .select("id");

  if (publishError) {
    return Response.json(
      { error: `公開できませんでした: ${publishError.message}` },
      { status: 500 },
    );
  }

  const published = (publishedRows ?? []).length;
  const isUpdate = (alreadyPublished ?? 0) > 0;

  // 公開したものが無ければお知らせも出さない (毎回押しても通知が増えないように)
  if (published === 0) {
    return Response.json({ published: 0, notified: 0, updated: isUpdate });
  }

  const admin = createAdminClient();
  const { data: recipients, error: recipientError } = await admin
    .from("profiles")
    .select("user_id")
    .neq("role", "ob");

  if (recipientError) {
    // 公開自体は済んでいる。お知らせだけ失敗したことを正直に返す
    return Response.json(
      {
        published,
        notified: 0,
        updated: isUpdate,
        error: `公開しましたが、お知らせを配れませんでした: ${recipientError.message}`,
      },
      { status: 207 },
    );
  }

  const title = `${year}年${month}月の練習予定が${isUpdate ? "更新" : "公開"}されました`;
  const rows = ((recipients ?? []) as { user_id: string }[]).map((r) => ({
    user_id: r.user_id,
    type: "schedule_updated" as const,
    title,
    body: `${published}件のコマが公開されました。全体カレンダーで確認してください`,
  }));

  const { error: notifyError } = rows.length
    ? await admin.from("notifications").insert(rows)
    : { error: null };

  if (notifyError) {
    return Response.json(
      {
        published,
        notified: 0,
        updated: isUpdate,
        error: `公開しましたが、お知らせを配れませんでした: ${notifyError.message}`,
      },
      { status: 207 },
    );
  }

  return Response.json({
    published,
    notified: rows.length,
    updated: isUpdate,
  });
}
