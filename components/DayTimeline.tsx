"use client";

import { useState } from "react";

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
  /**
   * 時間を埋めるだけの予定 (「空き」)。**折りたたみの判断に使わない** (v1.31.5)。
   * 空きは長い時間帯に広がるので、数えると1日がほぼ埋まって何も畳めない
   */
  filler?: boolean;
}

/** 1時間 32px (v1.31.5。48px では朝から晩までが何画面にもなった) */
const PX_PER_MINUTE = 32 / 60;
/** 折りたたんだ時間帯の1行の高さ */
const FOLD_HEIGHT = 22;
/** 練習の無い時間がこれだけ続いたら折りたたむ (分)。1時間だけの隙間は畳んでも短くならない */
const MIN_FOLD_MINUTES = 120;
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
  // 開いた折りたたみ (日付ごと。「折りたたむ」で閉じ直せる)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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
  const segments = foldSegments(axis, events).map((segment) => ({
    ...segment,
    folded: segment.foldable && !expanded.has(`${date}|${segment.start}`),
  }));
  // 分 → 上からの位置。畳んだ区間の中は FOLD_HEIGHT に縮めて比例で置く
  const y = (minute: number): number => {
    let top = 0;
    for (const segment of segments) {
      const length = segment.end - segment.start;
      const segmentHeight = segment.folded ? FOLD_HEIGHT : length * PX_PER_MINUTE;
      if (minute <= segment.end) {
        const within = Math.max(0, minute - segment.start);
        return top + (segment.folded ? (within / length) * FOLD_HEIGHT : within * PX_PER_MINUTE);
      }
      top += segmentHeight;
    }
    return top;
  };
  const height = y(axis.end);
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

  // 目盛は開いている区間だけ。畳んだ区間の両端も、1行の見出しが時刻を示すので描かない (重なる)
  const hours: number[] = [];
  for (let m = axis.start; m <= axis.end; m += 60) {
    const inFold = segments.some((s) => s.folded && m >= s.start && m <= s.end);
    if (!inFold) hours.push(m);
  }

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
              style={{ top: y(m) }}
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
              style={{ top: y(m) }}
            />
          ))}

          {packed.map(({ item, lane, lanes, region }) => {
            const [from, to] = region;
            const laneWidth = (to - from) / lanes;
            const top = y(toMinutes(item.startTime));
            const blockHeight = y(toMinutes(item.endTime)) - top;
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

        {/*
         * 畳んだ時間帯。時間軸の列もまたいで全幅に置き、押すと開く。
         * 中を通る「空き」は下に縮めて見えるよう、背景は少し透かす
         */}
        {segments
          .filter((segment) => segment.folded)
          .map((segment) => (
            <button
              key={segment.start}
              type="button"
              onClick={() =>
                setExpanded((prev) => new Set(prev).add(`${date}|${segment.start}`))
              }
              aria-label={`${fromMinutes(segment.start)}〜${fromMinutes(segment.end)} を開く`}
              // 帯は細いままにし、押せる範囲だけ上下に広げる (v1.32.7)
              className="absolute inset-x-0 z-10 flex items-center gap-1.5 border-y border-dashed border-[var(--border)] bg-[var(--cell)]/80 px-2 text-[11px] text-[var(--muted)] tabular-nums before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']"
              style={{ top: y(segment.start), height: FOLD_HEIGHT }}
            >
              <span>
                {fromMinutes(segment.start)}〜{fromMinutes(segment.end)}
              </span>
              <span aria-hidden>⌄</span>
            </button>
          ))}

        {/*
         * 開いた時間帯には「折りたたむ」を置く (v1.31.5)。その時間帯には
         * 空き以外の予定が無いので、左の広い列の頭に置いても予定とは重ならない
         */}
        {segments
          .filter((segment) => segment.foldable && !segment.folded)
          .map((segment) => (
            <button
              key={`fold-${segment.start}`}
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  next.delete(`${date}|${segment.start}`);
                  return next;
                })
              }
              aria-label={`${fromMinutes(segment.start)}〜${fromMinutes(segment.end)} を折りたたむ`}
              className="absolute z-10 flex min-h-8 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--cell)] px-3 py-1 text-[12px] text-[var(--tint)] tabular-nums"
              style={{ top: y(segment.start) + 4, left: TIME_COLUMN_WIDTH + 6 }}
            >
              <span aria-hidden>⌃</span>
              <span>
                {fromMinutes(segment.start)}〜{fromMinutes(segment.end)} を折りたたむ
              </span>
            </button>
          ))}
      </div>

      {/*
       * 「自分の予定を押すと出欠…」の注記は v1.31.9 でやめた。10px の文字が
       * 読みにくく、同じことは ? の「欠席・遅刻を伝える」で引ける
       */}
    </div>
  );
}

/**
 * 時間軸を「開いておく区間」と「畳める区間」に分ける (v1.31.5)。
 *
 * 1時間ごとに、空き以外の予定が掛かっているかを見る。掛かっていない時間が
 * MIN_FOLD_MINUTES 以上続いたところを畳める区間にする。空き以外の予定が
 * 1件も無い日は畳まない (空きしか無い日に全部畳むと何も見えない)。
 */
function foldSegments(
  axis: { start: number; end: number },
  events: TimelineEvent[],
): { start: number; end: number; foldable: boolean }[] {
  const busy = events.filter((event) => !event.filler);
  if (busy.length === 0) return [{ start: axis.start, end: axis.end, foldable: false }];

  const isBusy = (from: number, to: number) =>
    busy.some((event) => toMinutes(event.startTime) < to && toMinutes(event.endTime) > from);

  const segments: { start: number; end: number; foldable: boolean }[] = [];
  let m = axis.start;
  while (m < axis.end) {
    const next = Math.min(m + 60, axis.end);
    const free = !isBusy(m, next);
    const last = segments[segments.length - 1];
    if (last && last.foldable === free) last.end = next;
    else segments.push({ start: m, end: next, foldable: free });
    m = next;
  }
  // 短い隙間は畳まない (開いた区間に戻して隣とつなぐ)
  const merged: typeof segments = [];
  for (const segment of segments) {
    const foldable = segment.foldable && segment.end - segment.start >= MIN_FOLD_MINUTES;
    const last = merged[merged.length - 1];
    if (last && !last.foldable && !foldable) last.end = segment.end;
    else merged.push({ ...segment, foldable });
  }
  return merged;
}
