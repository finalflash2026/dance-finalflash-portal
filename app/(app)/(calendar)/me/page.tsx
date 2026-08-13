import Link from "next/link";
import { redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import {
  addMonths,
  endOfMonth,
  formatDateLabel,
  formatTimeRange,
  parseDate,
  startOfMonth,
  todayInTokyo,
} from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/**
 * タブ③ マイカレンダー (SPEC.md §6.4) — 簡易版
 *
 * **月単位で表示する**。タブ①と同じく URL の ?date= が表示中の月を決めるので、
 * 過去の月に戻って自分の申請や公式練を振り返れる。
 *
 * 抽出は購読ics と同じ getMyEvents() を使う。片方だけ条件がズレると
 * 「サイトには出るが ics に出ない」という事故になるため、必ず共用する。
 *
 * 未実装(後のフェーズ): 今日の予定カード / お知らせカード / 絞り込みチップ /
 * ミニカレンダー(**ドットではなく予定ラベル表示**。v1.7 §6.4) / 出欠管理窓(§6.4.2)
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function MyCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const { date } = await searchParams;
  const today = todayInTokyo();
  const selectedDate = date && DATE_PATTERN.test(date) ? date : today;
  const monthStart = startOfMonth(selectedDate);
  const { year, month } = parseDate(monthStart);

  const supabase = await createClient();
  const events = await getMyEvents(
    supabase,
    profile,
    monthStart,
    endOfMonth(selectedDate),
  );

  // 日付ごとにまとめる (getMyEvents は日付→開始時刻の順で返す)
  const byDate = new Map<DateString, MyEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }

  const href = (target: DateString) =>
    `/me?date=${encodeURIComponent(target)}`;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <h1 className="text-xl font-bold">マイカレンダー</h1>

      {/* 月送り。新しい月のデータが要るので実際に遷移する。
          prefetch を明示して RSC ペイロードごと先読みさせる */}
      <nav className="flex items-center justify-between rounded-xl border border-[var(--border)] px-2 py-1">
        <Link
          href={href(addMonths(monthStart, -1))}
          prefetch
          aria-label="前の月"
          className="px-3 py-1 text-lg"
        >
          ‹
        </Link>
        <h2 className="text-base font-bold">
          {year}年{month}月
        </h2>
        <Link
          href={href(addMonths(monthStart, 1))}
          prefetch
          aria-label="次の月"
          className="px-3 py-1 text-lg"
        >
          ›
        </Link>
      </nav>

      <p className="text-sm text-[var(--muted)]">
        {profile.role === "ob"
          ? "ナンバーの予定のみ表示されます。"
          : "1〜3ジャンの公式練と、自分の空き申請が表示されます。"}
      </p>

      {byDate.size === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          この月の予定はありません
        </p>
      ) : (
        <ul className="space-y-4">
          {[...byDate].map(([eventDate, dayEvents]) => (
            <li key={eventDate}>
              <h3
                className={`text-sm font-bold ${eventDate === today ? "" : "text-[var(--muted)]"}`}
              >
                {formatDateLabel(eventDate)}
                {eventDate === today ? " (今日)" : ""}
              </h3>
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
