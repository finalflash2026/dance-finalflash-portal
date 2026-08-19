"use client";

import { useEffect, useState } from "react";

import {
  AttendanceSheet,
  type AttendanceTarget,
} from "@/components/AttendanceSheet";
import { DayTimeline, type TimelineEvent } from "@/components/DayTimeline";
import { LabelCalendar } from "@/components/LabelCalendar";
import {
  NotificationList,
  type NotificationRow,
} from "@/components/NotificationList";
import {
  GENRE_COLORS,
  SLOT_CLAIMED_COLOR,
  type GenreCode,
} from "@/lib/constants";
import { eventColor, eventFilterKey } from "@/lib/event-display";
import { numberColor } from "@/lib/numbers";
import { formatDateLabel, formatTimeRange } from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/**
 * タブ③ マイカレンダーの操作部 (SPEC.md §6.4)
 *
 * 上から: 今日の予定カード → お知らせ → 絞り込みチップ →
 *         予定ラベル付きミニカレンダー → 日別の縦タイムライン
 *
 * 日付の選択はクライアント側だけで完結する (サーバーは月ぶんをまとめて
 * 取っており、同じ月内では取りに行くデータが無い)。タブ①②と同じ方針。
 */

/** チップの選択を覚えておくキー (SPEC §6.4-3「選択状態はローカル保存」) */
const FILTER_STORAGE_KEY = "me-calendar-filter";

export function MyCalendarClient({
  monthAnchor,
  initialDate,
  today,
  events,
  todayEvents,
  notifications,
  numbers,
  genreCodes,
  isOb,
  currentUserId,
}: {
  monthAnchor: DateString;
  initialDate: DateString;
  today: DateString;
  events: MyEvent[];
  todayEvents: MyEvent[];
  notifications: NotificationRow[];
  numbers: { id: string; name: string }[];
  /** 自分の1〜3ジャン。その月に予定が無くてもチップは出す */
  genreCodes: string[];
  isOb: boolean;
  currentUserId: string;
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [filter, setFilter] = useState("all");
  /** 出欠管理窓を開いている予定 (SPEC §6.4.2) */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // localStorage はサーバーで読めないので、描画後に反映する。
  // 既に消えたナンバーのキーが残っていても "all" に落ちるだけで害は無い
  useEffect(() => {
    const saved = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (saved) setFilter(saved);
  }, []);

  function selectFilter(key: string) {
    setFilter(key);
    window.localStorage.setItem(FILTER_STORAGE_KEY, key);
  }

  function selectDate(date: DateString) {
    setSelectedDate(date);
    // 今日を選んだときは ?date= を消す。残すと次に開いたとき当時の日付が出る
    window.history.replaceState(
      null,
      "",
      date === today
        ? window.location.pathname
        : `?date=${encodeURIComponent(date)}`,
    );
  }

  const matches = (event: MyEvent) =>
    filter === "all" || eventFilterKey(event) === filter;

  const visible = events.filter(matches);
  const eventsByDate = new Map<DateString, MyEvent[]>();
  for (const event of visible) {
    const list = eventsByDate.get(event.date) ?? [];
    list.push(event);
    eventsByDate.set(event.date, list);
  }

  const dayList = eventsByDate.get(selectedDate) ?? [];
  const dayEvents: TimelineEvent[] = dayList.map((event) => ({
    key: `${event.kind}-${event.sourceId}`,
    startTime: event.startTime,
    endTime: event.endTime,
    title: event.title,
    subtitle: event.location,
    color: eventColor(event),
  }));
  // タイムラインは表示用の型しか持たないので、タップされたものを key で引き直す
  const byKey = new Map(
    dayList.map((event) => [`${event.kind}-${event.sourceId}`, event]),
  );
  const selectedEvent = selectedKey ? (byKey.get(selectedKey) ?? null) : null;

  // 「すべて / 各ジャンル / 空き申請 / 各ナンバー」(SPEC §6.4-3 / v1.10)。
  // 公式練をひとまとめにしていると「今週のBREAKだけ見たい」ができなかった。
  // OB は公式練も空き申請も持たないので、そのぶんのチップを出さない (§6.4-0)。
  // 色を添えてカレンダーのラベルと対応が取れるようにする
  const chips: { key: string; label: string; color?: string }[] = [
    { key: "all", label: "すべて" },
    ...(isOb
      ? []
      : genreCodes.map((code) => ({
          key: `genre:${code}`,
          label: code,
          color: GENRE_COLORS[code as GenreCode]?.bg,
        }))),
    ...(isOb ? [] : [{ key: "claim", label: "空き申請", color: SLOT_CLAIMED_COLOR.bg }]),
    ...numbers.map((number) => ({
      key: `number:${number.id}`,
      label: number.name,
      color: numberColor(number.id).bg,
    })),
  ];

  return (
    <>
      <TodayCard events={todayEvents} />

      <NotificationList initial={notifications} />

      {chips.length > 1 ? (
        <nav
          aria-label="絞り込み"
          className="h-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => selectFilter(chip.key)}
              aria-pressed={filter === chip.key}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                filter === chip.key
                  ? "border-[var(--foreground)] bg-[var(--foreground)] font-bold text-white"
                  : "border-[var(--border)]"
              }`}
            >
              {chip.color ? (
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: chip.color }}
                />
              ) : null}
              {chip.label}
            </button>
          ))}
        </nav>
      ) : null}

      <LabelCalendar
        basePath="/me"
        monthAnchor={monthAnchor}
        selectedDate={selectedDate}
        today={today}
        eventsByDate={eventsByDate}
        onSelectDate={selectDate}
      />

      <section className="space-y-1">
        <h2 className="text-sm font-bold">
          {formatDateLabel(selectedDate)} の予定
          {selectedDate === today ? (
            <span className="ml-1 font-normal text-[var(--muted)]">(今日)</span>
          ) : null}
        </h2>
        <DayTimeline
          date={selectedDate}
          events={dayEvents}
          onSelect={(event) => setSelectedKey(event.key)}
        />
      </section>

      {selectedEvent ? (
        <AttendanceSheet
          target={attendanceTarget(selectedEvent)}
          title={selectedEvent.title}
          date={selectedEvent.date}
          startTime={selectedEvent.startTime}
          endTime={selectedEvent.endTime}
          location={selectedEvent.location}
          currentUserId={currentUserId}
          onClose={() => setSelectedKey(null)}
        />
      ) : null}
    </>
  );
}

/** 空き申請は出欠の対象外なので情報表示だけにする (SPEC §6.4.2) */
function attendanceTarget(event: MyEvent): AttendanceTarget {
  // 同じ時間帯に部屋を2つ押さえた公式練は1件にまとめてあるので、
  // 出欠を読むときは元のコマ全部を渡す (SPEC §6.4-1 / v1.12)
  if (event.kind === "genre") {
    return { kind: "slot", id: event.sourceId, ids: event.sourceIds };
  }
  if (event.kind === "number") {
    return { kind: "numberEvent", id: event.sourceId };
  }
  return { kind: "info" };
}

/** SPEC §6.4-1: 当日分の自分のイベントを時刻順に。0件でもカード自体は出す */
function TodayCard({ events }: { events: MyEvent[] }) {
  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <h2 className="text-sm font-bold">今日の予定</h2>
      {events.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--muted)]">
          今日の予定はありません
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {events.map((event) => {
            const color = eventColor(event);
            return (
              <li
                key={`${event.kind}-${event.sourceId}`}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  aria-hidden
                  className="h-4 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: color.bg }}
                />
                <span className="shrink-0 tabular-nums text-[var(--muted)]">
                  {formatTimeRange(event.startTime, event.endTime)}
                </span>
                <span className="min-w-0 truncate">
                  {event.title}
                  {event.location ? (
                    <span className="text-[var(--muted)]"> @{event.location}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
