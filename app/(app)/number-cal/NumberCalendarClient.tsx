"use client";

import { useState } from "react";

import { AttendanceSheet } from "@/components/AttendanceSheet";
import { DayTimeline, type TimelineEvent } from "@/components/DayTimeline";
import { MiniCalendar } from "@/components/MiniCalendar";
import { NumberList, type NumberSummary } from "@/components/NumberList";
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
  currentUserId,
  numbers,
  numbersError,
}: {
  monthAnchor: DateString;
  initialDate: DateString;
  today: DateString;
  events: NumberEventRow[];
  currentUserId: string;
  /** 所属しているナンバー。タブを開いた時点で出す (v1.14.2) */
  numbers: NumberSummary[];
  numbersError: string | null;
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  /** 出欠管理窓を開いている予定 (SPEC §6.4.2。タブ②からも同じ窓を開ける) */
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const dayList = events.filter((event) => event.date === selectedDate);
  const dayEvents: TimelineEvent[] = dayList.map((event) => ({
    key: event.id,
    startTime: event.startTime,
    endTime: event.endTime,
    title: event.numberName,
    subtitle: event.place,
    color: numberColor(event.numberId),
  }));
  const selected = dayList.find((event) => event.id === selectedId) ?? null;

  return (
    <>
      {/*
        並びは **所属ナンバー → 新規作成 → カレンダー** (v1.14.2)。
        タブ②を開いてまず知りたいのは「今どのナンバーに入っているか」で、
        日程の確認はそこから入る。以前はカレンダーだけが出ていて、
        ナンバーの管理は「ナンバー管理」ボタンの先にあった。
      */}
      <NumberList
        numbers={numbers}
        currentUserId={currentUserId}
        loadError={numbersError}
      />

      <h2 className="pt-1 text-sm font-bold">ナンバーの予定</h2>

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
          onSelect={(event) => setSelectedId(event.key)}
        />
      </section>

      {selected ? (
        <AttendanceSheet
          target={{ kind: "numberEvent", id: selected.id }}
          title={selected.numberName}
          date={selected.date}
          startTime={selected.startTime}
          endTime={selected.endTime}
          location={selected.place}
          currentUserId={currentUserId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </>
  );
}
