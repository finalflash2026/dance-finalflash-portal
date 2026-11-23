import { checkCronSecret } from "@/lib/cron-auth";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents } from "@/lib/events";
import { activeMemberIds, sendPush } from "@/lib/push";
import {
  IMPORTANT_DEADLINE_LEAD_DAYS,
  buildDeadlineReminders,
  buildTodayReminder,
  type DeadlineRow,
} from "@/lib/reminders";
import { hasSchemaV2 } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, isValidDateString, todayInTokyo } from "@/lib/time";
import type { Profile } from "@/lib/types";

/**
 * GET /api/cron/reminders  (SPEC.md §6.7.3 / §8.13 / v1.30)
 *
 * 毎朝 7:00 (JST) に Vercel Cron から呼ばれ、
 *   1. 今日予定がある人に「今日の予定」
 *   2. 現役全員に「今日締切」と、大事な締切の「1週間後に締切」
 * を送る。
 *
 * **「今日の予定」は通知を受け取る設定の端末を持つ人だけ計算する。**
 * 予定は1人ずつ引く (getMyEvents) ので、全員ぶん引いてから捨てるのは無駄。
 *
 * `?date=YYYY-MM-DD` で日付を変えられる (試験用)。`?dry=1` なら送らずに
 * 件数だけ返す。どちらも CRON_SECRET が要る。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 150人ぶんの予定を引くので、既定の待ち時間では足りないことがある
export const maxDuration = 60;

/** 同時に予定を引く人数。Supabase へ一度に投げすぎない */
const CONCURRENCY = 8;

export async function GET(request: Request) {
  const denied = checkCronSecret(request);
  if (denied) return denied;

  if (!hasSupabaseEnv()) {
    return Response.json(
      { ok: false, error: "Supabase の環境変数が未設定です。" },
      { status: 503 },
    );
  }

  // 予定・締切の通知の列と締切の表は 0020 から (v1.49)。済んでいない DB では何もしない
  if (!(await hasSchemaV2())) {
    return Response.json({ ok: true, skipped: "schema" });
  }

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const today =
    dateParam && isValidDateString(dateParam) ? dateParam : todayInTokyo();
  const dry = url.searchParams.get("dry") === "1";

  const admin = createAdminClient();

  // ---- 1. 今日の予定 ----
  const { data: subscriptions, error: subscriptionError } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("notify_reminder", true);
  if (subscriptionError) {
    return Response.json(
      { ok: false, error: subscriptionError.message },
      { status: 500 },
    );
  }

  const userIds = [
    ...new Set(
      (subscriptions ?? []).map((row) => (row as { user_id: string }).user_id),
    ),
  ];

  let profiles: Profile[] = [];
  if (userIds.length > 0) {
    const { data, error } = await admin
      .from("profiles")
      .select("*")
      .in("user_id", userIds);
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
    profiles = (data ?? []) as Profile[];
  }

  let todayUsers = 0;
  let todaySent = 0;
  const failures: string[] = [];

  await eachLimited(profiles, CONCURRENCY, async (profile) => {
    try {
      // service role で引くが、getMyEvents は絞り込みをすべてクエリに
      // 明示しているので他人の予定は混ざらない (§6.4 / §13.2)。
      // 前日から跨いできた深夜練を落とさないよう、前日ぶんから見る
      const events = await getMyEvents(admin, profile, addDays(today, -1), today, {
        includeDeadlines: false,
      });
      const message = buildTodayReminder(events, today);
      if (!message) return;
      todayUsers++;
      if (dry) return;
      const result = await sendPush({
        category: "reminder",
        userIds: [profile.user_id],
        payload: { ...message, url: `/?date=${today}` },
      });
      todaySent += result.sent;
    } catch (cause) {
      // 1人の失敗で全員ぶんを止めない
      failures.push(
        `${profile.username}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  });

  // ---- 2. 締切 ----
  const { data: deadlineData, error: deadlineError } = await admin
    .from("deadlines")
    .select("id, title, due_date, due_time, important")
    .in("due_date", [today, addDays(today, IMPORTANT_DEADLINE_LEAD_DAYS)]);
  if (deadlineError) {
    return Response.json({ ok: false, error: deadlineError.message }, { status: 500 });
  }

  const deadlineMessages = buildDeadlineReminders(
    (deadlineData ?? []) as DeadlineRow[],
    today,
  );
  let deadlineSent = 0;
  if (!dry && deadlineMessages.length > 0) {
    const recipients = await activeMemberIds();
    for (const message of deadlineMessages) {
      const result = await sendPush({
        category: "deadline",
        userIds: recipients,
        payload: { ...message, url: "/" },
      });
      deadlineSent += result.sent;
    }
  }

  if (failures.length > 0) {
    console.error("[reminders] 一部の人の予定を引けませんでした", failures);
  }

  return Response.json({
    ok: true,
    date: today,
    dry,
    today: { users: todayUsers, sent: todaySent, failed: failures.length },
    deadlines: { count: deadlineMessages.length, sent: deadlineSent },
  });
}

/** 配列を最大 limit 件ずつ並行して処理する */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await task(item);
    }
  });
  await Promise.all(workers);
}
