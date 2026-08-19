"use client";

import Link from "next/link";

import { eventColor, eventShortLabel } from "@/lib/event-display";
import {
  addMonths,
  daysInMonth,
  formatDate,
  getWeekday,
  parseDate,
} from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/**
 * 予定ラベル付きのミニカレンダー (SPEC.md §6.4-4 / v1.7)
 *
 * タブ③だけドットではなくラベルを出す。件数が少なく、内容まで一覧できるため。
 * タブ①②は MiniCalendar (ドット) のままで、こちらとは別物。
 *
 * **スマホでは1マスが 55px 程度しかない**ので、次の割り切りをしている:
 *   - 1マスに最大2件。超えたら `+N`
 *   - ラベルは色バー + 短縮名 (公式練=ジャンルコード / 申請=空き / ナンバー=先頭数文字)
 *   - 時刻は入らないので出さない。詳細は日付をタップした先のタイムラインで見る
 */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const MAX_LABELS = 2;

export function LabelCalendar({
  basePath,
  monthAnchor,
  selectedDate,
  today,
  eventsByDate,
  onSelectDate,
}: {
  basePath: string;
  monthAnchor: DateString;
  selectedDate: DateString;
  today: DateString;
  /** 絞り込み適用後の予定を日付ごとにまとめたもの */
  eventsByDate: Map<DateString, MyEvent[]>;
  onSelectDate: (date: DateString) => void;
}) {
  const { year, month } = parseDate(monthAnchor);
  const total = daysInMonth(year, month);
  const leading = getWeekday(formatDate(year, month, 1));
  const cells: (DateString | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => formatDate(year, month, i + 1)),
  ];

  const href = (date: DateString) =>
    `${basePath}?date=${encodeURIComponent(date)}`;
  const todayInThisMonth = cells.includes(today);

  return (
    <section className="rounded-xl border border-[var(--border)] px-1.5 py-1.5">
      <header className="flex items-center justify-between">
        <Link
          href={href(addMonths(monthAnchor, -1))}
          prefetch
          aria-label="前の月"
          className="px-3 py-0.5 text-lg"
        >
          ‹
        </Link>
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-bold">
            {year}年{month}月
          </h2>
          {selectedDate !== today ? (
            <a
              href={href(today)}
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  !todayInThisMonth
                ) {
                  return;
                }
                event.preventDefault();
                onSelectDate(today);
              }}
              className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]"
            >
              今日
            </a>
          ) : null}
        </div>
        <Link
          href={href(addMonths(monthAnchor, 1))}
          prefetch
          aria-label="次の月"
          className="px-3 py-0.5 text-lg"
        >
          ›
        </Link>
      </header>

      <div className="mt-1 grid grid-cols-7 gap-px">
        {WEEKDAYS.map((label, index) => (
          <div
            key={label}
            className={`py-0.5 text-center text-[10px] ${
              index === 0
                ? "text-[var(--accent)]"
                : index === 6
                  ? "text-[var(--info)]"
                  : "text-[var(--muted)]"
            }`}
          >
            {label}
          </div>
        ))}

        {cells.map((date, index) => {
          if (!date) return <div key={`blank-${index}`} />;

          const isSelected = date === selectedDate;
          const isToday = date === today;
          const dayEvents = eventsByDate.get(date) ?? [];
          const shown = dayEvents.slice(0, MAX_LABELS);
          const rest = dayEvents.length - shown.length;

          return (
            <a
              key={date}
              href={href(date)}
              aria-current={isSelected ? "date" : undefined}
              aria-label={`${parseDate(date).day}日 予定${dayEvents.length}件`}
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                onSelectDate(date);
              }}
              className={`flex min-h-14 flex-col items-stretch rounded p-0.5 ${
                isSelected ? "bg-[var(--surface)] ring-1 ring-[var(--foreground)]" : ""
              }`}
            >
              <span
                className={`mx-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  isToday ? "bg-[var(--primary)] font-bold text-[var(--primary-fg)]" : ""
                }`}
              >
                {parseDate(date).day}
              </span>

              <span className="mt-0.5 flex flex-col gap-px overflow-hidden">
                {shown.map((event) => {
                  const color = eventColor(event);
                  return (
                    <span
                      key={`${event.kind}-${event.sourceId}`}
                      className="truncate rounded-sm px-0.5 text-[8px] leading-[11px]"
                      style={{
                        backgroundColor: color.bg,
                        color: color.fg,
                      }}
                    >
                      {eventShortLabel(event)}
                    </span>
                  );
                })}
                {rest > 0 ? (
                  <span className="text-center text-[8px] leading-[11px] text-[var(--muted)]">
                    +{rest}
                  </span>
                ) : null}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
