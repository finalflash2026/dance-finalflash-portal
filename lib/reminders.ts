import { expandMyEvents } from "@/lib/event-display";
import { addDays, formatDateLabel } from "@/lib/time";
import type { DateString, MyEvent, TimeString } from "@/lib/types";

/**
 * 朝のリマインドの文面 (SPEC.md §6.7.3 / v1.30)
 *
 * 送る処理 (app/api/cron/reminders) と分けて、**文面と「誰に何を」だけ**を
 * ここに置く。DB も通知も触らないので、そのまま確かめられる。
 *
 * 文面は §6.6 の約束どおり**中身を詰め込みすぎない**。ロック画面に出るので、
 * 予定名・時刻・締切名まで。場所や本文は開いた先で読ませる。
 */

export interface ReminderMessage {
  title: string;
  body: string;
  tag: string;
}

/**
 * 「今日の予定」。今日に掛かる予定が1件も無ければ null (その人には送らない)。
 *
 * - **前日の夜から跨いできた深夜練の後半は数えない。** 朝7時には終わっている
 * - 複数日のイベント (合宿など) は2日目以降も「今日の予定」として出す
 * - 締切は入れない (別の通知で届く)
 */
export function buildTodayReminder(
  events: readonly MyEvent[],
  today: DateString,
): ReminderMessage | null {
  const todays = expandMyEvents(events.filter((event) => event.kind !== "deadline"))
    .filter((entry) => entry.date === today && entry.part !== "second")
    .sort((a, b) => {
      // 終日 (イベント) を先頭に、あとは開始時刻順
      const allDayA = isWholeDay(a);
      const allDayB = isWholeDay(b);
      if (allDayA !== allDayB) return allDayA ? -1 : 1;
      return a.startTime.localeCompare(b.startTime);
    });

  if (todays.length === 0) return null;

  const first = todays[0];
  const head = isWholeDay(first)
    ? first.event.title
    : `${first.startTime} ${first.event.title}`;
  const rest = todays.length - 1;

  return {
    title: "今日の予定",
    body: rest > 0 ? `${head} ほか${rest}件` : `${head} があります`,
    tag: `today-${today}`,
  };
}

/** 終日の予定か、複数日イベントの中日 (その日は丸1日) */
function isWholeDay(entry: {
  event: MyEvent;
  startTime: string;
  endTime: string;
}): boolean {
  return (
    Boolean(entry.event.allDay) ||
    (entry.startTime === "00:00" && entry.endTime === "24:00")
  );
}

export interface DeadlineRow {
  id: string;
  title: string;
  due_date: DateString;
  due_time: TimeString | null;
  important: boolean;
}

/** 1週間前に知らせる日数 (大事な締切だけ) */
export const IMPORTANT_DEADLINE_LEAD_DAYS = 7;

/**
 * 今朝送る締切の通知。
 *
 * - 期限が**今日**のもの … すべて
 * - 期限が**1週間後**のもの … 大事な締切だけ
 */
export function buildDeadlineReminders(
  deadlines: readonly DeadlineRow[],
  today: DateString,
): ReminderMessage[] {
  const weekLater = addDays(today, IMPORTANT_DEADLINE_LEAD_DAYS);
  const messages: ReminderMessage[] = [];

  for (const deadline of deadlines) {
    if (deadline.due_date === today) {
      messages.push({
        title: "今日締切",
        body: deadline.due_time
          ? `${deadline.title} (${deadline.due_time.slice(0, 5)}まで)`
          : deadline.title,
        tag: `deadline-${deadline.id}-today`,
      });
    } else if (deadline.important && deadline.due_date === weekLater) {
      messages.push({
        title: `1週間後に締切 ${formatDateLabel(deadline.due_date)}`,
        body: deadline.title,
        tag: `deadline-${deadline.id}-week`,
      });
    }
  }
  return messages;
}
