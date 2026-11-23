import { expandMyEvents } from "@/lib/event-display";
import {
  IMPORTANT_DEADLINE_LEAD_DAYS,
  buildDeadlineReminders,
  buildTodayReminder,
  type DeadlineRow,
} from "@/lib/reminders";
import { addDays } from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/**
 * iOS アプリに渡す「これからの予定」(SPEC.md §2.3.1 / v1.38)
 *
 * アプリはこれを受け取って、①端末に通知を予約し ②ウィジェットに出す。
 * DB も通知も触らない (app/api/app/digest が予定を引いて渡す)。
 * 通知の文面は朝のリマインド (lib/reminders.ts) と同じものを使う。
 */

/** 何日先まで渡すか。アプリを開かないままでも、この日数ぶんは通知が届く */
export const DIGEST_DAYS = 14;
/** 朝の通知の時刻 (§6.7.3 の Cron と同じ 7:00) */
export const DIGEST_NOTIFY_TIME = "07:00";
/** iOS が1つのアプリに予約させてくれるのは64件まで。余裕を残す */
export const DIGEST_MAX_NOTIFICATIONS = 60;

export type DigestCategory = "reminder" | "deadline";

export interface DigestItem {
  id: string;
  kind: MyEvent["kind"];
  date: DateString;
  start: string;
  end: string;
  allDay: boolean;
  title: string;
  location: string;
  important: boolean;
}

export interface DigestDay {
  date: DateString;
  items: DigestItem[];
}

export interface DigestNotification {
  /** 端末の通知の ID。同じ通知は毎回同じ値になる (予約し直しで重ならない) */
  id: number;
  category: DigestCategory;
  /** 鳴らす時刻 (日本時間を明示した ISO 形式) */
  at: string;
  title: string;
  body: string;
  /** 押したときに開く画面 */
  path: string;
}

/**
 * ホームの要約 (大きいウィジェット用。v1.41)。鍵は受け取った時点のもの
 * (ウィジェットはその時刻を添えて出す)
 */
export interface DigestDashboard {
  round: { title: string; deadline: DateString } | null;
  keys: { unlocked: number; holder: string | null } | null;
  deadlines: { title: string; date: DateString; dueTime: string | null; important: boolean }[];
}

export interface AppDigest {
  today: DateString;
  days: DigestDay[];
  notifications: DigestNotification[];
  dashboard: DigestDashboard;
}

/** 大きいウィジェットに出す締切の数と先の日数 */
const DASHBOARD_DEADLINES = 4;
const DASHBOARD_DEADLINE_DAYS = 14;

/**
 * @param events today-1 〜 today+DIGEST_DAYS+7 の予定 (締切を含む)。
 *   前日ぶんは日をまたぐ深夜練、7日先ぶんは「1週間後に締切」のため
 * @param now いまの日本時間 (YYYY-MM-DDTHH:MM)。過ぎた時刻の通知は作らない
 */
export function buildAppDigest(
  events: readonly MyEvent[],
  today: DateString,
  now: string,
  extras: Pick<DigestDashboard, "round" | "keys"> = { round: null, keys: null },
): AppDigest {
  const last = addDays(today, DIGEST_DAYS - 1);
  const plain = events.filter((event) => event.kind !== "deadline");
  const deadlines = events.filter((event) => event.kind === "deadline");

  const days: DigestDay[] = [];
  const entries = expandMyEvents(events);
  for (let date: DateString = today; date <= last; date = addDays(date, 1)) {
    const items = entries
      .filter((entry) => entry.date === date)
      .map(
        (entry): DigestItem => ({
          id: `${entry.event.kind}-${entry.event.sourceId}-${entry.date}`,
          kind: entry.event.kind,
          date: entry.date,
          start: entry.startTime,
          end: entry.endTime,
          allDay:
            Boolean(entry.event.allDay) ||
            (entry.startTime === "00:00" && entry.endTime === "24:00"),
          title: entry.event.title,
          location: entry.event.location,
          important: Boolean(entry.event.important),
        }),
      )
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.localeCompare(b.start);
      });
    days.push({ date, items });
  }

  const rows: DeadlineRow[] = deadlines.map((event) => ({
    id: event.sourceId,
    title: event.title.replace(/^締切: /, ""),
    due_date: event.date,
    due_time: event.dueTime ?? null,
    important: Boolean(event.important),
  }));

  const notifications: DigestNotification[] = [];
  for (let date: DateString = today; date <= last; date = addDays(date, 1)) {
    const at = `${date}T${DIGEST_NOTIFY_TIME}`;
    if (at <= now) continue;
    const iso = `${at}:00+09:00`;

    const reminder = buildTodayReminder(plain, date);
    if (reminder) {
      notifications.push({
        id: notificationId(reminder.tag),
        category: "reminder",
        at: iso,
        title: reminder.title,
        body: reminder.body,
        path: `/?date=${date}`,
      });
    }

    const due = rows.filter(
      (row) =>
        row.due_date === date ||
        row.due_date === addDays(date, IMPORTANT_DEADLINE_LEAD_DAYS),
    );
    for (const message of buildDeadlineReminders(due, date)) {
      notifications.push({
        id: notificationId(message.tag),
        category: "deadline",
        at: iso,
        title: message.title,
        body: message.body,
        path: "/",
      });
    }
  }

  notifications.sort((a, b) => a.at.localeCompare(b.at));

  const dashboardDeadlines = rows
    .filter((row) => row.due_date >= today && row.due_date <= addDays(today, DASHBOARD_DEADLINE_DAYS))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.due_time ?? "24").localeCompare(b.due_time ?? "24"))
    .slice(0, DASHBOARD_DEADLINES)
    .map((row) => ({
      title: row.title,
      date: row.due_date,
      dueTime: row.due_time ? row.due_time.slice(0, 5) : null,
      important: row.important,
    }));

  return {
    today,
    days,
    notifications: notifications.slice(0, DIGEST_MAX_NOTIFICATIONS),
    dashboard: { ...extras, deadlines: dashboardDeadlines },
  };
}

/** 通知の tag から、iOS の通知 ID に使う正の32ビット整数を作る (FNV-1a) */
export function notificationId(tag: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    hash ^= tag.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // 0 は避ける (未設定と区別がつかない)
  return (hash >>> 1) || 1;
}
