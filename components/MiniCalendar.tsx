import Link from "next/link";

import {
  addMonths,
  daysInMonth,
  formatDate,
  getWeekday,
  parseDate,
  todayInTokyo,
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
 * 状態は URL (?date=YYYY-MM-DD) が持つため、クライアント JS を使わず
 * Link だけで組む。戻る/進むや共有もそのまま効く。
 */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function MiniCalendar({
  basePath,
  selectedDate,
  markedDates,
}: {
  /** 日付リンクの遷移先 (例: "/") */
  basePath: string;
  selectedDate: DateString;
  /** ドットを出す日 */
  markedDates: DateString[];
}) {
  const { year, month } = parseDate(selectedDate);
  const today = todayInTokyo();
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
          href={href(addMonths(selectedDate, -1))}
          aria-label="前の月"
          className="px-3 py-1 text-lg"
        >
          ‹
        </Link>
        <h2 className="text-base font-bold">
          {year}年{month}月
        </h2>
        <Link
          href={href(addMonths(selectedDate, 1))}
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
            <Link
              key={date}
              href={href(date)}
              aria-current={isSelected ? "date" : undefined}
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
            </Link>
          );
        })}
      </div>
    </section>
  );
}
