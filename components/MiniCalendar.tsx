"use client";

import Link from "next/link";

import {
  addMonths,
  daysInMonth,
  formatDate,
  getWeekday,
  parseDate,
} from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * 月のミニカレンダー (SPEC.md §6.0 共通ナビゲーションパターン)
 *
 * - 予定が存在する日にドットを表示
 * - 日付タップでその日の詳細ビューへ
 * - 月送り(前月/翌月)
 * - 初期値は当日を含む月・当日選択
 *
 * **日付と月でナビゲーションの扱いが違う**:
 *   日付 … 同じ月のデータは既に取得済みなので、サーバーへ行かず
 *          onSelectDate で親の state を更新する (往復ゼロ)
 *   月送り … 新しい月のデータが要るので実際に遷移する。
 *          ただし prefetch を明示して RSC ペイロードごと先読みさせる
 *          (既定の prefetch は loading 境界までしか先読みしない)
 *
 * 日付は `<a href>` のままにしてあるので、JS が無効でも従来どおり遷移でき、
 * 中クリックで別タブに開くこともできる。
 */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function MiniCalendar({
  basePath,
  monthAnchor,
  selectedDate,
  today,
  markedDates,
  onSelectDate,
}: {
  /** 日付リンクの遷移先 (例: "/") */
  basePath: string;
  /** 表示中の月 (この月の日を並べる) */
  monthAnchor: DateString;
  selectedDate: DateString;
  /** JST の今日。サーバーで求めた値を渡す (クライアントの時計に依存させない) */
  today: DateString;
  /** ドットを出す日 */
  markedDates: DateString[];
  onSelectDate: (date: DateString) => void;
}) {
  const { year, month } = parseDate(monthAnchor);
  const marked = new Set(markedDates);

  const total = daysInMonth(year, month);
  const leading = getWeekday(formatDate(year, month, 1));
  const cells: (DateString | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => formatDate(year, month, i + 1)),
  ];

  const href = (date: DateString) =>
    `${basePath}?date=${encodeURIComponent(date)}`;

  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <header className="flex items-center justify-between">
        <Link
          href={href(addMonths(monthAnchor, -1))}
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
          href={href(addMonths(monthAnchor, 1))}
          prefetch
          aria-label="次の月"
          className="px-3 py-1 text-lg"
        >
          ›
        </Link>
      </header>

      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((label, index) => (
          <div
            key={label}
            className={`py-1 text-xs ${
              index === 0
                ? "text-[#C0392B]"
                : index === 6
                  ? "text-[#2F6FB5]"
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
          const day = parseDate(date).day;

          return (
            <a
              key={date}
              href={href(date)}
              aria-current={isSelected ? "date" : undefined}
              onClick={(event) => {
                // 修飾キー付き(別タブで開く等)は既定の動作に任せる
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
              className="flex flex-col items-center py-1"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                  isSelected
                    ? "bg-[var(--foreground)] font-bold text-white"
                    : isToday
                      ? "border border-[var(--foreground)] font-bold"
                      : ""
                }`}
              >
                {day}
              </span>
              <span
                aria-hidden
                className={`mt-0.5 h-1 w-1 rounded-full ${
                  marked.has(date) ? "bg-[var(--muted)]" : "bg-transparent"
                }`}
              />
            </a>
          );
        })}
      </div>
    </section>
  );
}
