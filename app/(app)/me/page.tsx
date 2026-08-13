import { redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDateLabel, formatTimeRange, todayInTokyo } from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/**
 * タブ③ マイカレンダー (SPEC.md §6.4) — 簡易版
 *
 * 抽出は購読ics と同じ getMyEvents() を使う。片方だけ条件がズレると
 * 「サイトには出るが ics に出ない」という事故になるため、必ず共用する。
 *
 * 未実装(後のフェーズ): 今日の予定カード / お知らせカード / 絞り込みチップ /
 * ミニカレンダー(**ドットではなく予定ラベル表示**。v1.7 §6.4) / 出欠管理窓(§6.4.2)
 */

/** 一覧に出す範囲 */
const RANGE_DAYS = 30;

export default async function MyCalendarPage() {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const today = todayInTokyo();
  const supabase = await createClient();
  const events = await getMyEvents(
    supabase,
    profile,
    today,
    addDays(today, RANGE_DAYS),
  );

  // 日付ごとにまとめる (getMyEvents は日付→開始時刻の順で返す)
  const byDate = new Map<DateString, MyEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <h1 className="text-xl font-bold">マイカレンダー</h1>
      <p className="text-sm text-[var(--muted)]">
        今日からの{RANGE_DAYS}日間の自分の予定です。
        {profile.role === "ob"
          ? "ナンバーの予定のみ表示されます。"
          : "1〜3ジャンの公式練と、自分の空き申請が含まれます。"}
      </p>

      {byDate.size === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          予定はありません
        </p>
      ) : (
        <ul className="space-y-4">
          {[...byDate].map(([date, dayEvents]) => (
            <li key={date}>
              <h2
                className={`text-sm font-bold ${date === today ? "" : "text-[var(--muted)]"}`}
              >
                {formatDateLabel(date)}
                {date === today ? " (今日)" : ""}
              </h2>
              <ul className="mt-1 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
                {dayEvents.map((event) => (
                  <li
                    key={`${event.kind}-${event.sourceId}`}
                    className="flex gap-3 px-3 py-2 text-sm"
                  >
                    <span className="shrink-0 tabular-nums text-[var(--muted)]">
                      {formatTimeRange(event.startTime, event.endTime)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{event.title}</span>
                      {event.location ? (
                        <span className="block text-xs text-[var(--muted)]">
                          @{event.location}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
