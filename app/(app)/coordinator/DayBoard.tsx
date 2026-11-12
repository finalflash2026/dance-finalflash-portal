"use client";

import { useEffect, useMemo, useState } from "react";

import {
  GENRES,
  GENRE_BY_ID,
  GENRE_COLORS,
  SLOT_OPEN_COLOR,
  SLOT_UNAVAILABLE_COLOR,
  shortRoomName,
  type GenreCode,
} from "@/lib/constants";
import { groupRoomsBySection, type Room } from "@/lib/rooms";
import { availabilityRatio, type AvailabilityLookup } from "@/lib/scheduling/availability";
import {
  buildGrid,
  cellKey,
  periodsFor,
  rowCountForDate,
  summarize,
  type GridCell,
  type PeriodTable,
  type SlotPeriod,
} from "@/lib/slot-grid";
import { formatDateLabel, formatTimeRange } from "@/lib/time";
import type { DateString } from "@/lib/types";

import type { Brush, PaintTarget } from "./SlotGrid";
import type { ReservationInfo } from "./useMonthReservations";

/**
 * 割り振りを日ごとのカードで見る (SPEC.md §6.2 / v1.48)
 *
 * コマ割り表は列 (部屋) が多く、上下左右にスクロールしないと1日も見渡せない。
 * ここでは1日1枚のカードに、建物ごと・**その日に予約のある部屋だけ**を並べ、
 * 縦にだけスクロールする。練習を押すと、ジャンルを出られる人の多い順に並べた窓で直す。
 */
export function DayBoard({
  dates,
  rooms,
  table,
  reservations,
  disabled,
  availability,
  onPaint,
}: {
  dates: readonly DateString[];
  rooms: readonly Room[];
  table: PeriodTable;
  reservations: readonly ReservationInfo[];
  disabled: boolean;
  availability: AvailabilityLookup | null;
  onPaint: (targets: PaintTarget[], brush: Brush) => void;
}) {
  const [editing, setEditing] = useState<PaintTarget | null>(null);

  const sections = useMemo(() => groupRoomsBySection(rooms), [rooms]);
  const sectionNames = sections.map((group) => group.section);
  const input = {
    dates,
    rooms,
    periodsFor: (date: DateString, section: string) => periodsFor(table, date, section),
    rowCount: (date: DateString) => rowCountForDate(table, date, sectionNames),
    reservations,
  };
  const { cells } = buildGrid(input);
  const totals = summarize(input, cells);

  // 日 → 建物 → (予約のある部屋・コマ)。予約の無い日・建物・部屋・コマは出さない
  const days = dates
    .map((date) => {
      const rows = rowCountForDate(table, date, sectionNames);
      const blocks = sections
        .map((group) => {
          const periods = periodsFor(table, date, group.section).slice(0, rows);
          const cellOf = (room: Room, period: SlotPeriod) => cells.get(cellKey(date, room.id, period.position));
          const used = (cell: GridCell | undefined) => cell !== undefined && cell.kind !== "none";
          const roomList = group.rooms.filter((room) => periods.some((p) => used(cellOf(room, p))));
          const periodList = periods.filter((p) => roomList.some((room) => used(cellOf(room, p))));
          return { section: group.section, rooms: roomList, periods: periodList, cellOf };
        })
        .filter((block) => block.rooms.length > 0);
      return { date, blocks };
    })
    .filter((day) => day.blocks.length > 0);

  if (days.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* ジャンルごとの今月のコマ数。均等に配れているかを見る */}
      <div className="flex flex-wrap gap-1.5" aria-label="ジャンルごとのコマ数">
        {GENRES.map((genre) => {
          const color = GENRE_COLORS[genre.code];
          return (
            <span
              key={genre.id}
              className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--cell)] pl-2 pr-3 text-[13px] font-semibold"
            >
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: color.bg }} />
              {genre.code}
              <span className="tabular-nums text-[var(--muted)]">{totals.byGenre.get(genre.id) ?? 0}</span>
            </span>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {days.map((day) => (
          <section key={day.date} className="space-y-2 rounded-2xl bg-[var(--cell)] p-3" aria-label={formatDateLabel(day.date)}>
            <h3 className="text-[17px] font-bold tabular-nums">{formatDateLabel(day.date)}</h3>
            {/* 建物のまとまりを横に並べ、入らなければ折り返す */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-2">
            {day.blocks.map((block) => (
              <div key={block.section} style={{ gridColumn: block.rooms.length > 1 ? `span ${Math.min(block.rooms.length, 3)}` : undefined }}>
                <table className="w-full table-fixed border-separate border-spacing-1">
                  <thead>
                    <tr>
                      <th className="w-[44px] text-left text-[11px] font-semibold text-[var(--muted)]">{block.section}</th>
                      {block.rooms.map((room) => (
                        <th
                          key={room.id}
                          title={room.name}
                          className="truncate text-[11px] font-normal text-[var(--muted)]"
                        >
                          {shortRoomName(room.name)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.periods.map((period) => (
                      <tr key={period.position}>
                        <th className="text-left text-[11px] font-normal leading-tight text-[var(--muted)] tabular-nums">
                          {period.startTime}
                          <br />
                          〜{period.endTime}
                        </th>
                        {block.rooms.map((room) => {
                          const cell = block.cellOf(room, period);
                          return (
                            <td key={room.id}>
                              {cell && cell.kind !== "none" ? (
                                <Chip
                                  cell={cell}
                                  label={`${formatDateLabel(day.date)} ${formatTimeRange(period.startTime, period.endTime)} ${room.name}`}
                                  people={
                                    availability && cell.kind === "genre" && cell.slot?.genreId != null
                                      ? availability(day.date, period.startTime, period.endTime, cell.slot.genreId)
                                      : null
                                  }
                                  disabled={disabled}
                                  onClick={() => setEditing({ date: day.date, room, period, cell })}
                                />
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            </div>
          </section>
        ))}
      </div>

      {editing ? (
        <SlotSheet
          target={editing}
          availability={availability}
          monthCounts={totals.byGenre}
          onPick={(brush) => {
            onPaint([editing], brush);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/** 置けるセルか (SlotGrid と同じ。古いコマが残っていても、覆う予約枠があれば置き換えられる) */
function editable(cell: GridCell): boolean {
  if (cell.kind === "none" || cell.kind === "partial") return false;
  if (cell.kind === "conflict") return cell.reservationId !== null;
  return true;
}

function Chip({
  cell,
  label,
  people,
  disabled,
  onClick,
}: {
  cell: GridCell;
  label: string;
  people: { ok: number; maybe: number; total: number } | null;
  disabled: boolean;
  onClick: () => void;
}) {
  const base =
    "flex h-10 w-full flex-col items-center justify-center rounded-lg text-[12px] font-bold leading-tight transition-transform active:scale-95 disabled:active:scale-100";
  const can = editable(cell) && !disabled;

  if (cell.kind === "genre") {
    const genre = cell.slot?.genreId != null ? GENRE_BY_ID.get(cell.slot.genreId) : null;
    const color = genre ? GENRE_COLORS[genre.code as GenreCode] : SLOT_OPEN_COLOR;
    return (
      <button
        type="button"
        disabled={!can}
        onClick={onClick}
        aria-label={`${label} ${genre?.code ?? "公式練"}${people ? ` ○${people.ok}人 △${people.maybe}人 / ${people.total}人` : ""}${cell.slot?.published ? "" : " 下書き"}`}
        className={`${base} ${cell.slot?.published ? "" : "outline-dashed outline-1 -outline-offset-2 outline-white/60"}`}
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        <span className="truncate">{genre?.code ?? "公式練"}</span>
        {people ? (
          <span aria-hidden className="text-[10px] font-semibold tabular-nums opacity-80">
            ○{people.ok}/{people.total}
          </span>
        ) : null}
      </button>
    );
  }

  const face =
    cell.kind === "open"
      ? { text: "空き", bg: SLOT_OPEN_COLOR.bg, fg: SLOT_OPEN_COLOR.fg, name: "空き" }
      : cell.kind === "unavailable"
        ? { text: "−", bg: SLOT_UNAVAILABLE_COLOR.bg, fg: SLOT_UNAVAILABLE_COLOR.fg, name: "使用不可" }
        : cell.kind === "partial"
          ? { text: "△", bg: "transparent", fg: "var(--danger-fg)", name: "予約がコマの時間を覆えていない" }
          : cell.kind === "conflict"
            ? { text: "⚠", bg: "transparent", fg: "var(--danger-fg)", name: "区切りの合わない古いコマ" }
            : { text: "＋", bg: "var(--background)", fg: "var(--muted)", name: "未割当" };

  return (
    <button
      type="button"
      disabled={!can}
      onClick={onClick}
      aria-label={`${label} ${face.name}`}
      className={`${base} ${cell.kind === "unassigned" ? "border border-dashed border-[var(--border)] text-[16px] font-normal" : ""}`}
      style={{ backgroundColor: face.bg, color: face.fg }}
    >
      {face.text}
    </button>
  );
}

/** 練習を押したときの窓。ジャンルを出られる人の多い順に並べる */
function SlotSheet({
  target,
  availability,
  monthCounts,
  onPick,
  onClose,
}: {
  target: PaintTarget;
  availability: AvailabilityLookup | null;
  monthCounts: Map<number, number>;
  onPick: (brush: Brush) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { date, room, period, cell } = target;
  const current = cell.kind === "genre" ? (cell.slot?.genreId ?? null) : null;
  const rows = GENRES.map((genre, index) => {
    const people = availability ? availability(date, period.startTime, period.endTime, genre.id) : null;
    return { genre, index, people, ratio: people ? availabilityRatio(people) : 0 };
  });
  if (availability) rows.sort((a, b) => b.ratio - a.ratio || a.index - b.index);

  const tool = "h-11 flex-1 rounded-xl bg-[var(--fill)] text-[15px] font-semibold active:opacity-70";

  return (
    <div data-no-swipe className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <button type="button" aria-label="閉じる" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="slot-sheet-title"
        className="sheet-in safe-bottom relative z-10 flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-[22px] bg-[var(--background)] sm:rounded-[22px]"
      >
        <header className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id="slot-sheet-title" className="text-[20px] font-bold leading-tight tabular-nums">
              {formatDateLabel(date)} {formatTimeRange(period.startTime, period.endTime)}
            </h2>
            <p className="mt-0.5 text-[14px] text-[var(--muted)]">{room.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="glass glass-press grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--muted)]"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <p aria-hidden className="flex justify-end px-8 pb-1 text-[11px] text-[var(--muted)]">今月</p>
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5" aria-label="ジャンル">
          {rows.map(({ genre, people, ratio }) => {
            const color = GENRE_COLORS[genre.code];
            const on = current === genre.id;
            return (
              <li key={genre.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onPick({ kind: "genre", genreId: genre.id })}
                  aria-label={`${genre.code}${people ? ` ○${people.ok}人 △${people.maybe}人 / ${people.total}人` : ""} 今月${monthCounts.get(genre.id) ?? 0}コマ`}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-[background-color,box-shadow] active:opacity-70 ${
                    on ? "bg-[var(--cell)] shadow-[0_0_0_2px_var(--tint)]" : "bg-[var(--cell)]"
                  }`}
                >
                  <span aria-hidden className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: color.bg }} />
                  <span className="w-[72px] shrink-0 text-[15px] font-semibold">{genre.code}</span>
                  {people ? (
                    <span aria-hidden className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--fill)]">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: color.bg }}
                        />
                      </span>
                      <span className="shrink-0 text-[13px] tabular-nums">
                        ○{people.ok}
                        {people.maybe ? <span className="text-[var(--muted)]"> △{people.maybe}</span> : null}
                        <span className="text-[var(--muted)]"> /{people.total}</span>
                      </span>
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span aria-hidden className="w-10 shrink-0 text-right text-[12px] text-[var(--muted)] tabular-nums">
                    {monthCounts.get(genre.id) ?? 0}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex gap-2 px-5 pb-4 pt-3">
          <button type="button" onClick={() => onPick({ kind: "open" })} aria-pressed={cell.kind === "open"} className={tool}>
            空き
          </button>
          <button
            type="button"
            onClick={() => onPick({ kind: "unavailable" })}
            aria-pressed={cell.kind === "unavailable"}
            className={tool}
          >
            使用不可
          </button>
          <button
            type="button"
            onClick={() => onPick({ kind: "clear" })}
            disabled={cell.kind === "unassigned"}
            className={`${tool} text-[var(--danger-fg)] disabled:opacity-40`}
          >
            消す
          </button>
        </div>
      </div>
    </div>
  );
}
