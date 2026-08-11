"use client";

import { useEffect, useState } from "react";

import {
  GENRE_COLORS,
  ROOMS,
  ROOM_SECTIONS,
  SLOT_OPEN_COLOR,
  SLOT_UNAVAILABLE_COLOR,
  type GenreCode,
} from "@/lib/constants";
import {
  DAY_END_TIME,
  DAY_START_TIME,
  TIMELINE_STEP_MINUTES,
  formatDateLabel,
  formatTimeRange,
  fromMinutes,
  toMinutes,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

/**
 * 日別詳細ビュー (SPEC.md §6.1)
 *
 * - **列=練習場所 / 行=時間** のグリッド (Excel表の1日分に相当)
 * - 列は rooms を section ごとにグループ化した固定順 (§4.2)。
 *   その日 slot が1件も無い部屋列は非表示にして幅を節約する
 * - 行は 09:00〜22:00 の時間軸 (30分刻みの目盛)。
 *   slot は開始〜終了の長さを持つブロックとして描画する
 * - 横スクロール可。時間軸列は sticky 固定
 *
 * Phase 1 は閲覧のみ。空きブロックからの申請フロー (claims) は Phase 2。
 */

export interface DayBlock {
  id: string;
  roomId: number;
  startTime: string;
  endTime: string;
  status: SlotStatus;
  genreCode: string | null;
  targetGenerations: number[] | null;
  note: string | null;
}

const COLUMN_WIDTH = 112;
const TIME_COLUMN_WIDTH = 52;
const PX_PER_MINUTE = 1.2;

export function DayGrid({
  date,
  blocks,
}: {
  date: DateString;
  blocks: DayBlock[];
}) {
  const [selected, setSelected] = useState<DayBlock | null>(null);

  const dayStart = toMinutes(DAY_START_TIME);
  const dayEnd = toMinutes(DAY_END_TIME);
  const totalHeight = (dayEnd - dayStart) * PX_PER_MINUTE;

  // その日に slot がある部屋だけを §4.2 の順で、section ごとにまとめる
  const usedRoomIds = new Set(blocks.map((b) => b.roomId));
  const groups = ROOM_SECTIONS.map((section) => ({
    section,
    rooms: ROOMS.filter((r) => r.section === section && usedRoomIds.has(r.id)),
  })).filter((g) => g.rooms.length > 0);
  const flatRooms = groups.flatMap((g) => g.rooms);

  const ticks: number[] = [];
  for (let m = dayStart; m <= dayEnd; m += TIMELINE_STEP_MINUTES) ticks.push(m);

  if (flatRooms.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
        {formatDateLabel(date)} の練習予定はありません
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <div className="w-max">
          {/* section 見出し */}
          <div className="flex border-b border-[var(--border)] bg-[var(--surface)]">
            <div
              className="sticky left-0 z-20 shrink-0 bg-[var(--surface)]"
              style={{ width: TIME_COLUMN_WIDTH }}
            />
            {groups.map((group) => (
              <div
                key={group.section}
                className="shrink-0 border-l border-[var(--border)] px-1 py-1 text-center text-xs font-bold"
                style={{ width: group.rooms.length * COLUMN_WIDTH }}
              >
                {group.section}
              </div>
            ))}
          </div>

          {/* 部屋名 */}
          <div className="flex border-b border-[var(--border)]">
            <div
              className="sticky left-0 z-20 shrink-0 bg-[var(--background)]"
              style={{ width: TIME_COLUMN_WIDTH }}
            />
            {flatRooms.map((room) => (
              <div
                key={room.id}
                className="shrink-0 border-l border-[var(--border)] px-1 py-2 text-center text-[11px] leading-tight"
                style={{ width: COLUMN_WIDTH }}
              >
                {room.name}
              </div>
            ))}
          </div>

          {/* 本体 */}
          <div className="flex" style={{ height: totalHeight }}>
            {/* 時間軸 (sticky) */}
            <div
              className="sticky left-0 z-20 relative shrink-0 bg-[var(--background)]"
              style={{ width: TIME_COLUMN_WIDTH }}
            >
              {ticks.map((minute) => (
                <div
                  key={minute}
                  className="absolute right-1 -translate-y-1/2 text-[10px] text-[var(--muted)]"
                  style={{ top: (minute - dayStart) * PX_PER_MINUTE }}
                >
                  {minute % 60 === 0 ? fromMinutes(minute) : ""}
                </div>
              ))}
            </div>

            {flatRooms.map((room) => (
              <div
                key={room.id}
                className="relative shrink-0 border-l border-[var(--border)]"
                style={{ width: COLUMN_WIDTH }}
              >
                {/* 目盛線 */}
                {ticks.map((minute) => (
                  <div
                    key={minute}
                    className="absolute inset-x-0 border-t"
                    style={{
                      top: (minute - dayStart) * PX_PER_MINUTE,
                      borderColor:
                        minute % 60 === 0 ? "var(--border)" : "transparent",
                    }}
                  />
                ))}

                {blocks
                  .filter((block) => block.roomId === room.id)
                  .map((block) => (
                    <SlotBlock
                      key={block.id}
                      block={block}
                      dayStart={dayStart}
                      dayEnd={dayEnd}
                      onSelect={setSelected}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected ? (
        <SlotDetailModal block={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

function SlotBlock({
  block,
  dayStart,
  dayEnd,
  onSelect,
}: {
  block: DayBlock;
  dayStart: number;
  dayEnd: number;
  onSelect: (block: DayBlock) => void;
}) {
  // 表示範囲 (09:00〜22:00) の外にはみ出す slot は端で切って描く
  const start = Math.max(toMinutes(block.startTime), dayStart);
  const end = Math.min(toMinutes(block.endTime), dayEnd);
  if (end <= start) return null;

  const color = blockColor(block);

  return (
    <button
      type="button"
      onClick={() => onSelect(block)}
      className="absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight"
      style={{
        top: (start - dayStart) * PX_PER_MINUTE,
        height: (end - start) * PX_PER_MINUTE,
        backgroundColor: color.bg,
        color: color.fg,
      }}
    >
      <span className="block font-bold">{blockLabel(block)}</span>
      <span className="block opacity-80">
        {formatTimeRange(block.startTime, block.endTime)}
      </span>
    </button>
  );
}

function blockColor(block: DayBlock) {
  if (block.status === "unavailable") return SLOT_UNAVAILABLE_COLOR;
  if (block.status === "open") return SLOT_OPEN_COLOR;
  const code = block.genreCode as GenreCode | null;
  return code && code in GENRE_COLORS
    ? GENRE_COLORS[code]
    : SLOT_UNAVAILABLE_COLOR;
}

function blockLabel(block: DayBlock): string {
  if (block.status === "unavailable") return "×";
  if (block.status === "open") return "空き";
  const generations = block.targetGenerations?.length
    ? `(${block.targetGenerations.join("・")}期)`
    : "";
  return `${block.genreCode ?? "?"}${generations}`;
}

/** ブロックタップで開く詳細 (SPEC §6.1)。Phase 1 は閲覧のみ */
function SlotDetailModal({
  block,
  onClose,
}: {
  block: DayBlock;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const room = ROOMS.find((r) => r.id === block.roomId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="コマの詳細"
        className="relative z-10 w-full max-w-sm rounded-t-2xl bg-[var(--background)] p-5 sm:rounded-2xl"
      >
        <h3 className="text-lg font-bold">{blockLabel(block)}</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-[var(--muted)]">時間</dt>
            <dd>{formatTimeRange(block.startTime, block.endTime)}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-[var(--muted)]">場所</dt>
            <dd>{room?.name ?? "-"}</dd>
          </div>
          {block.targetGenerations?.length ? (
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-[var(--muted)]">対象</dt>
              <dd>{block.targetGenerations.join("・")}期</dd>
            </div>
          ) : null}
          {block.note ? (
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-[var(--muted)]">メモ</dt>
              <dd>{block.note}</dd>
            </div>
          ) : null}
        </dl>

        {block.status === "open" ? (
          <p className="mt-4 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
            空きコマの使用申請は Phase 2 で使えるようになります
          </p>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-[var(--border)] py-2 text-sm font-medium"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
