"use client";

import Link from "next/link";
import { useRef } from "react";

import { eventColor, eventShortLabel } from "@/lib/event-display";
import { eventInk, eventTint } from "@/lib/event-style";
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
  onChangeMonth,
}: {
  basePath: string;
  monthAnchor: DateString;
  selectedDate: DateString;
  today: DateString;
  /** 絞り込み適用後の予定を日付ごとにまとめたもの */
  eventsByDate: Map<DateString, MyEvent[]>;
  onSelectDate: (date: DateString) => void;
  /**
   * 月を切り替える (v1.31.10)。渡すと前後の月ボタンと、枠の中の左右スワイプで
   * ページを読み直さずに切り替える。渡さないときは従来どおりリンクで移る
   */
  onChangeMonth?: (diff: -1 | 1) => void;
}) {
  // 左右スワイプで月を切り替える。縦の動き (画面のスクロール) が大きいときは拾わない
  const touchStart = useRef<{ x: number; y: number } | null>(null);
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
    <section
      className="rounded-xl bg-[var(--cell)] px-1.5 py-1.5"
      // 画面全体のタブ切り替えのスワイプと取り合わないように (SwipeTabs)
      data-no-swipe={onChangeMonth ? true : undefined}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || !onChangeMonth) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        onChangeMonth(dx < 0 ? 1 : -1);
      }}
    >
      <header className="flex items-center justify-between">
        <MonthButton
          label="前の月"
          href={href(addMonths(monthAnchor, -1))}
          onClick={onChangeMonth ? () => onChangeMonth(-1) : undefined}
        >
          ‹
        </MonthButton>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[16px] font-bold">
            {year}年{month}月
          </h2>
          {/* 見出しの上に「今日」ボタンがある画面 (ホーム) では重ねて出さない */}
          {selectedDate !== today && !onChangeMonth ? (
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
        <MonthButton
          label="次の月"
          href={href(addMonths(monthAnchor, 1))}
          onClick={onChangeMonth ? () => onChangeMonth(1) : undefined}
        >
          ›
        </MonthButton>
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
              className="flex min-h-14 flex-col items-stretch rounded-md p-0.5"
            >
              {/* 日付の丸 (Apple のカレンダーと同じ: 今日は赤、選んだ日は黒。v1.50) */}
              <span
                className={`mx-auto flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] tabular-nums ${
                  isSelected
                    ? isToday
                      ? "bg-[var(--accent)] font-semibold text-white"
                      : "bg-[var(--foreground)] font-semibold text-[var(--background)]"
                    : isToday
                      ? "font-semibold text-[var(--accent)]"
                      : ""
                }`}
              >
                {parseDate(date).day}
              </span>

              <span className="mt-0.5 flex flex-col gap-px overflow-hidden">
                {shown.map((event) => {
                  const color = eventColor(event);
                  // 終日 (イベント・締切) は色の地に白い文字、時刻のある予定はうすい地に濃い文字
                  const allDay = event.kind === "deadline" || event.allDay === true;
                  return (
                    <span
                      key={`${event.kind}-${event.sourceId}`}
                      className="truncate rounded-[3px] px-[3px] text-[9px] font-medium leading-[13px]"
                      style={
                        allDay
                          ? { backgroundColor: color.bg, color: color.fg }
                          : { backgroundColor: eventTint(color.bg), color: eventInk(color.bg) }
                      }
                    >
                      {eventShortLabel(event)}
                    </span>
                  );
                })}
                {rest > 0 ? (
                  <span className="px-[3px] text-[9px] leading-[13px] text-[var(--muted)]">
                    ほか{rest}件
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

/** 前後の月へ。押しやすいよう 44px 四方 (v1.31.10) */
function MonthButton({
  label,
  href,
  onClick,
  children,
}: {
  label: string;
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const className =
    "grid h-11 w-11 place-items-center text-[24px] leading-none text-[var(--tint)] active:opacity-60";
  if (onClick) {
    return (
      <button type="button" aria-label={label} onClick={onClick} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link href={href} prefetch aria-label={label} className={className}>
      {children}
    </Link>
  );
}
