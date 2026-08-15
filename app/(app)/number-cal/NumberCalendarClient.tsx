"use client";

import Link from "next/link";
import { useState } from "react";

import { DayTimeline, type TimelineEvent } from "@/components/DayTimeline";
import { MiniCalendar } from "@/components/MiniCalendar";
import { numberColor } from "@/lib/numbers";
import { formatDateLabel } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * タブ② の「ミニカレンダー → 日別ビュー」導線 (SPEC.md §6.0 / §6.3)
 *
 * タブ①の CalendarView と同じ理由でクライアント側に日付を持つ:
 * サーバーは月ぶんをまとめて取っているので、同じ月内の日付切替では
 * 取りに行くデータが無い。URL は replaceState で合わせるだけにして
 * ナビゲーションを起こさない。
 */

export interface NumberEventRow {
  id: string;
  numberId: string;
  numberName: string;
  date: DateString;
  startTime: string;
  endTime: string;
  place: string;
  note: string | null;
}

export function NumberCalendarClient({
  monthAnchor,
  initialDate,
  today,
  events,
}: {
  monthAnchor: DateString;
  initialDate: DateString;
  today: DateString;
  events: NumberEventRow[];
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);

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

  const markedDates = [...new Set(events.map((event) => event.date))];
  const dayEvents: TimelineEvent[] = events
    .filter((event) => event.date === selectedDate)
    .map((event) => ({
      key: event.id,
      startTime: event.startTime,
      endTime: event.endTime,
      title: event.numberName,
      subtitle: event.place,
      color: numberColor(event.numberId),
    }));

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">
          所属しているナンバーの予定
        </p>
        <Link
          href="/numbers"
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1 text-sm"
        >
          ナンバー管理
        </Link>
      </div>

      <MiniCalendar
        basePath="/number-cal"
        monthAnchor={monthAnchor}
        selectedDate={selectedDate}
        today={today}
        markedDates={markedDates}
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
          emptyMessage="ナンバーの予定はありません"
        />
      </section>
    </>
  );
}
