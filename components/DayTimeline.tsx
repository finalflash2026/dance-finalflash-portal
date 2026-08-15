"use client";

import { packLanes, timelineAxis } from "@/lib/timeline";
import { formatDateLabel, formatTimeRange, fromMinutes, toMinutes } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * 日別の縦タイムライン (SPEC.md §6.3 / §6.4)
 *
 * **行=時間軸のみ・列なし** (Appleカレンダー様式)。タブ②とタブ③が共用する。
 * タブ①の DayGrid は「列=部屋」が固定なので別物で、こちらは
 * 重なった予定を横に並べて逃がす (lib/timeline.ts の packLanes)。
 *
 * タップしたときに何を開くかは呼び出し側が決める。タブ②③では出欠管理窓
 * (§6.4.2) を開くが、空き申請など対象外のものもあるため。
 */

export interface TimelineEvent {
  key: string;
  startTime: string;
  endTime: string;
  title: string;
  /** 場所や補足。狭いときは落とす */
  subtitle?: string;
  color: { bg: string; fg: string };
}

const PX_PER_MINUTE = 0.8;
const TIME_COLUMN_WIDTH = 44;
/** これより低いブロックはタイトルだけにする (2行だと両方切れて読めない) */
const COMPACT_BLOCK_HEIGHT = 30;

export function DayTimeline({
  date,
  events,
  emptyMessage = "予定はありません",
  onSelect,
}: {
  date: DateString;
  events: TimelineEvent[];
  emptyMessage?: string;
  onSelect?: (event: TimelineEvent) => void;
}) {
  if (events.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
        {formatDateLabel(date)} の{emptyMessage}
      </p>
    );
  }

  const axis = timelineAxis(events);
  const height = (axis.end - axis.start) * PX_PER_MINUTE;
  const packed = packLanes(events);

  const hours: number[] = [];
  for (let m = axis.start; m <= axis.end; m += 60) hours.push(m);

  return (
    <div className="rounded-xl border border-[var(--border)]">
      <div className="relative flex" style={{ height }}>
        {/* 時間軸 */}
        <div
          className="relative shrink-0 border-r border-[var(--border)]"
          style={{ width: TIME_COLUMN_WIDTH }}
        >
          {hours.map((m) => (
            <span
              key={m}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-[var(--muted)] tabular-nums"
              style={{ top: (m - axis.start) * PX_PER_MINUTE }}
            >
              {fromMinutes(m)}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          {hours.map((m) => (
            <div
              key={m}
              className="absolute inset-x-0 border-t border-[var(--border)]"
              style={{ top: (m - axis.start) * PX_PER_MINUTE }}
            />
          ))}

          {packed.map(({ item, lane, lanes }) => {
            const top = (toMinutes(item.startTime) - axis.start) * PX_PER_MINUTE;
            const blockHeight =
              (toMinutes(item.endTime) - toMinutes(item.startTime)) *
              PX_PER_MINUTE;
            const compact = blockHeight < COMPACT_BLOCK_HEIGHT;
            const range = formatTimeRange(item.startTime, item.endTime);

            return (
              <button
                key={item.key}
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(item)}
                title={`${range} ${item.title}${item.subtitle ? ` @${item.subtitle}` : ""}`}
                className="absolute overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight"
                style={{
                  top,
                  height: blockHeight,
                  // 重なった予定は横に分ける。1件のときは全幅
                  left: `calc(${(lane / lanes) * 100}% + 2px)`,
                  width: `calc(${100 / lanes}% - 4px)`,
                  backgroundColor: item.color.bg,
                  color: item.color.fg,
                }}
              >
                <span className="block truncate font-bold">{item.title}</span>
                {compact ? null : (
                  <span className="block truncate opacity-80">
                    {range}
                    {item.subtitle ? ` @${item.subtitle}` : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
