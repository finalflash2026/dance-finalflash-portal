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
  /**
   * 薄く出す (v1.30 §6.7.7)。他ジャンルの練習と空きコマ。
   * 全体を見渡せるが、自分の予定を探す邪魔をしない濃さにする
   */
  pale?: boolean;
}

const PX_PER_MINUTE = 0.8;
const TIME_COLUMN_WIDTH = 44;
/** これより低いブロックはタイトルだけにする (2行だと両方切れて読めない) */
const COMPACT_BLOCK_HEIGHT = 30;

export function DayTimeline({
  date,
  events,
  allDay = [],
  emptyMessage = "予定はありません",
  onSelect,
}: {
  date: DateString;
  events: TimelineEvent[];
  /**
   * 終日の予定 (v1.30。イベント・締切)。時間軸には置けないので、
   * タイムラインの上に1行ずつ並べる (Apple カレンダーの「終日」と同じ)
   */
  allDay?: TimelineEvent[];
  emptyMessage?: string;
  onSelect?: (event: TimelineEvent) => void;
}) {
  const allDayRows =
    allDay.length > 0 ? (
      <ul className="space-y-1 border-b border-[var(--separator)] p-1.5">
        {allDay.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(item)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] leading-tight"
              style={{ backgroundColor: item.color.bg, color: item.color.fg }}
            >
              <span className="shrink-0 opacity-80">終日</span>
              <span className="min-w-0 flex-1 truncate font-bold">{item.title}</span>
              {item.subtitle ? (
                <span className="shrink-0 truncate opacity-80">{item.subtitle}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  if (events.length === 0) {
    if (allDayRows) {
      return <div className="rounded-xl bg-[var(--cell)]">{allDayRows}</div>;
    }
    return (
      <p className="rounded-xl bg-[var(--cell)] px-4 py-8 text-center text-sm text-[var(--muted)]">
        {formatDateLabel(date)} の{emptyMessage}
      </p>
    );
  }

  const axis = timelineAxis(events);
  const height = (axis.end - axis.start) * PX_PER_MINUTE;
  /*
   * **薄い予定 (他ジャンル・空き) は右側の別の列に並べる** (v1.30)。
   * 同じ時間に9ジャンルの練習があると、混ぜて横に割ったとき自分の予定が
   * 1/10 の幅に潰れる。自分の予定は左の広い列を、重なり合うぶんだけで割る。
   */
  const mine = events.filter((event) => !event.pale);
  const pale = events.filter((event) => event.pale);
  const split = mine.length > 0 && pale.length > 0;
  const regions = split
    ? { mine: [0, 62], pale: [63, 100] }
    : { mine: [0, 100], pale: [0, 100] };
  const packed = [
    ...packLanes(mine).map((p) => ({ ...p, region: regions.mine })),
    ...packLanes(pale).map((p) => ({ ...p, region: regions.pale })),
  ];

  const hours: number[] = [];
  for (let m = axis.start; m <= axis.end; m += 60) hours.push(m);

  return (
    <div className="rounded-xl bg-[var(--cell)]">
      {allDayRows}
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

          {packed.map(({ item, lane, lanes, region }) => {
            const [from, to] = region;
            const laneWidth = (to - from) / lanes;
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
                // ボタンは中身を縦の中央に寄せるので、上詰めを明示する。
                // 長いブロックだと見出しが開始時刻から離れた位置に出てしまう
                className={`absolute flex flex-col justify-start overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight ${
                  item.pale ? "opacity-45" : ""
                }`}
                style={{
                  top,
                  height: blockHeight,
                  // 重なった予定は横に分ける。1件のときは全幅
                  left: `calc(${from + lane * laneWidth}% + 2px)`,
                  width: `calc(${laneWidth}% - 4px)`,
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

      {/*
       * ブロックは色の帯にしか見えず、押せると気づけない。
       * 出欠登録はここからしか開けない導線なので (SPEC §6.4.2)、
       * 折衝画面の凡例と同じく一行で明示しておく。
       */}
      {onSelect ? (
        <p className="border-t border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)]">
          自分の予定を押すと出欠、薄い「空き」を押すと申請できます
        </p>
      ) : null}
    </div>
  );
}
