"use client";

import { Fragment, useEffect, useState } from "react";

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
import {
  buildGrid,
  cellKey,
  formatMinutes,
  hasOverride,
  periodsFor,
  renumber,
  rowCountForDate,
  summarize,
  type GridCell,
  type PeriodTable,
  type SlotPeriod,
} from "@/lib/slot-grid";
import {
  finalizeTimeInput,
  formatDateLabel,
  formatTimeRange,
  normalizeTimeInput,
} from "@/lib/time";
import type { DateString } from "@/lib/types";

import type { ReservationInfo } from "./useMonthReservations";

/**
 * コマ割り表 (SPEC.md §6.2 Step2 / v1.28, v1.29)
 *
 * **折衝係が Excel で作っている表をそのまま画面にした**もの。
 * 列=練習場所(所在ごとに時間の列を挟む) / 行=日にち×コマ。
 *
 * 表の向きを以前のタイムライン (縦=日付×部屋 / 横=時刻) から入れ替えたのは、
 * **折衝の手順そのものが「この表を埋めていく」作業**だから。
 * 見ている紙と画面の形が違うと、1セルごとに目を移し替えることになる。
 *
 * この表が持つ仕掛けは4つ:
 *   ○ を自動で出す      … 予約枠とコマの時間を突き合わせれば決まる
 *   予約を裏に敷く        … コマの時間を直すときに、何時から何時まで
 *                          借りているのかが見えていないと決められない
 *   時間の列を直接直せる  … 例外は日にち・建物どちらの単位でも起きる
 *   同じジャンルは横に結合 … 1つの練習で2部屋使うことがある
 */

/** いま置くもの。セルを押すとこれが入る */
export type Brush =
  | { kind: "genre"; genreId: number }
  | { kind: "open" }
  | { kind: "unavailable" }
  | { kind: "clear" };

export interface PaintTarget {
  date: DateString;
  room: Room;
  period: SlotPeriod;
  cell: GridCell;
}

/** 時間の列を直したときの書き込み単位 */
export interface PeriodEdit {
  date: DateString;
  section: string;
  periods: SlotPeriod[];
}

const CELL_CLASS = "border border-[var(--border)] p-0 align-middle";
const HEAD_CLASS =
  "border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-[11px] font-bold whitespace-nowrap";

function brushLabel(brush: Brush): string {
  if (brush.kind === "genre") {
    return GENRE_BY_ID.get(brush.genreId)?.code ?? "公式練";
  }
  if (brush.kind === "open") return "空き ○";
  if (brush.kind === "unavailable") return "使用不可 −";
  return "消す";
}

function cellFace(cell: GridCell): {
  text: string;
  bg: string;
  fg: string;
  title: string;
} {
  switch (cell.kind) {
    case "genre": {
      const genre =
        cell.slot?.genreId != null ? GENRE_BY_ID.get(cell.slot.genreId) : null;
      const color = genre
        ? GENRE_COLORS[genre.code as GenreCode]
        : SLOT_OPEN_COLOR;
      return {
        text: genre?.code ?? "公式練",
        bg: color.bg,
        fg: color.fg,
        title: `公式練 ${genre?.code ?? ""}`,
      };
    }
    case "open":
      return {
        text: "○",
        bg: SLOT_OPEN_COLOR.bg,
        fg: SLOT_OPEN_COLOR.fg,
        title: "空き (個人練に開放)",
      };
    case "unavailable":
      return {
        text: "−",
        bg: SLOT_UNAVAILABLE_COLOR.bg,
        fg: SLOT_UNAVAILABLE_COLOR.fg,
        title: "使用不可",
      };
    case "unassigned":
      return {
        text: "○",
        bg: "transparent",
        fg: "var(--foreground)",
        title: "練習できます (未割当。公開すると「空き」になります)",
      };
    case "partial":
      return {
        text: "△",
        bg: "transparent",
        fg: "var(--danger-fg)",
        title:
          "予約はありますが、このコマの時間を覆えていません。裏の帯が借りている時間です",
      };
    default:
      return { text: "", bg: "transparent", fg: "", title: "予約なし" };
  }
}

export function SlotGrid({
  dates,
  rooms,
  table,
  reservations,
  disabled,
  onPaint,
  onSavePeriods,
  onChangeRowCount,
}: {
  dates: readonly DateString[];
  rooms: readonly Room[];
  table: PeriodTable;
  reservations: readonly ReservationInfo[];
  disabled: boolean;
  /** 横に結合したセルを押したときは、結合ぶんすべてが来る */
  onPaint: (targets: PaintTarget[], brush: Brush) => void;
  onSavePeriods: (edits: PeriodEdit[]) => void;
  onChangeRowCount: (date: DateString, delta: 1 | -1) => void;
}) {
  const [brush, setBrush] = useState<Brush | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    targets: PaintTarget[];
  } | null>(null);
  const [timeEdit, setTimeEdit] = useState<{
    x: number;
    y: number;
    date: DateString;
    section: string;
    index: number;
  } | null>(null);

  // 置くものを選んだままにしておくと事故のもとなので、Esc で必ず外せる
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (timeEdit) setTimeEdit(null);
      else if (menu) setMenu(null);
      else setBrush(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, timeEdit]);

  const sections = groupRoomsBySection(rooms);
  const sectionNames = sections.map((group) => group.section);

  const input = {
    dates,
    rooms,
    periodsFor: (date: DateString, section: string) =>
      periodsFor(table, date, section),
    rowCount: (date: DateString) => rowCountForDate(table, date, sectionNames),
    reservations,
  };
  const { cells, offGrid } = buildGrid(input);
  const totals = summarize(input, cells);

  /** 列の並び: 所在ごとに [時間の列, 部屋…] */
  const columns: (
    | { kind: "time"; section: string }
    | { kind: "room"; room: Room }
  )[] = [];
  for (const group of sections) {
    columns.push({ kind: "time", section: group.section });
    for (const room of group.rooms) columns.push({ kind: "room", room });
  }

  function handleCell(event: React.MouseEvent, targets: PaintTarget[]) {
    if (targets.length === 0) return;
    if (brush) {
      onPaint(targets, brush);
      return;
    }
    // まだ何も選んでいなければ、その場で選ばせる。
    // 選んだものはそのまま「いま置くもの」になり、次からは1クリックで置ける
    setMenu({ x: event.clientX, y: event.clientY, targets });
  }

  return (
    <div className="space-y-2">
      <BrushPalette brush={brush} onChange={setBrush} disabled={disabled} />

      <div className="h-scroll max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]">
        <table className="border-separate border-spacing-0 text-[11px]">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className={`${HEAD_CLASS} sticky top-0 left-0 z-40`}
              >
                コマ
              </th>
              {sections.map((group) => (
                <th
                  key={group.section}
                  colSpan={group.rooms.length + 1}
                  className={`${HEAD_CLASS} sticky top-0 z-30`}
                >
                  {group.section}
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((column) => (
                <th
                  key={
                    column.kind === "time"
                      ? `t-${column.section}`
                      : `r-${column.room.id}`
                  }
                  className={`${HEAD_CLASS} sticky top-[25px] z-30`}
                  style={{ minWidth: column.kind === "time" ? 86 : 62 }}
                  title={column.kind === "room" ? column.room.name : undefined}
                >
                  {column.kind === "time"
                    ? "時間割"
                    : shortRoomName(column.room.name)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {dates.map((date) => {
              const rows = rowCountForDate(table, date, sectionNames);
              return (
                <Fragment key={date}>
                  <tr>
                    <th
                      className={`${HEAD_CLASS} sticky left-0 z-20 text-left`}
                    >
                      {formatDateLabel(date)}
                    </th>
                    <td
                      colSpan={columns.length}
                      className="border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5"
                    >
                      <span className="mr-2 text-[10px] text-[var(--muted)]">
                        この日のコマ数 {rows}
                      </span>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChangeRowCount(date, 1)}
                        title="この日だけコマを1つ増やす"
                        className="mr-1 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-[11px] disabled:opacity-50"
                      >
                        ＋
                      </button>
                      <button
                        type="button"
                        disabled={disabled || rows <= 1}
                        onClick={() => onChangeRowCount(date, -1)}
                        title="この日だけコマを1つ減らす"
                        className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-[11px] disabled:opacity-50"
                      >
                        −
                      </button>
                    </td>
                  </tr>

                  {Array.from({ length: rows }, (_, index) => (
                    <tr key={`${date}-${index}`}>
                      <th
                        className={`${HEAD_CLASS} sticky left-0 z-20 text-center font-normal`}
                      >
                        {index + 1}
                      </th>
                      {renderRow({
                        columns,
                        date,
                        index,
                        table,
                        cells,
                        disabled,
                        onTime: (event, section) =>
                          setTimeEdit({
                            x: event.clientX,
                            y: event.clientY,
                            date,
                            section,
                            index,
                          }),
                        onCell: handleCell,
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Totals totals={totals} />
      <Legend />
      <OffGridNotice offGrid={offGrid} rooms={rooms} />

      {menu ? (
        <CellMenu
          x={menu.x}
          y={menu.y}
          targets={menu.targets}
          onPick={(picked) => {
            setBrush(picked.kind === "clear" ? null : picked);
            onPaint(menu.targets, picked);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {timeEdit ? (
        <TimeEditor
          {...timeEdit}
          table={table}
          dates={dates}
          sections={sectionNames}
          onSave={(edits) => {
            onSavePeriods(edits);
            setTimeEdit(null);
          }}
          onClose={() => setTimeEdit(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * 1行ぶんのセルを作る。
 *
 * **隣り合う同じジャンルは横に結合する** (v1.29)。狭い部屋しか取れなかった日に
 * 1つの練習で2部屋を同時に使うことがあり、別々のセルに同じ名前が並ぶと
 * 「2つの練習がある」ように見えてしまう。
 * 結合したセルを押したときは、結合ぶんすべてに同じものを置く。
 */
function renderRow({
  columns,
  date,
  index,
  table,
  cells,
  disabled,
  onTime,
  onCell,
}: {
  columns: (
    | { kind: "time"; section: string }
    | { kind: "room"; room: Room }
  )[];
  date: DateString;
  index: number;
  table: PeriodTable;
  cells: Map<string, GridCell>;
  disabled: boolean;
  onTime: (event: React.MouseEvent, section: string) => void;
  onCell: (event: React.MouseEvent, targets: PaintTarget[]) => void;
}) {
  const out: React.ReactNode[] = [];

  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i];

    if (column.kind === "time") {
      const period = periodsFor(table, date, column.section)[index];
      const overridden = hasOverride(table, date, column.section);
      out.push(
        <td key={`t-${column.section}`} className={CELL_CLASS}>
          <button
            type="button"
            disabled={disabled || !period}
            onClick={(event) => onTime(event, column.section)}
            title={`${formatDateLabel(date)} ${column.section} の${index + 1}コマ目 — 押すと時間を直せます`}
            className={`h-6 w-full px-1 text-center text-[11px] tabular-nums disabled:cursor-default ${
              overridden
                ? "font-bold text-[var(--info)]"
                : "text-[var(--muted)]"
            }`}
            style={{ backgroundColor: "var(--surface)" }}
          >
            {period
              ? formatTimeRange(period.startTime, period.endTime)
              : ""}
          </button>
        </td>,
      );
      continue;
    }

    // 部屋。同じ所在の中で、隣が同じジャンルなら結合する
    const room = column.room;
    const period = periodsFor(table, date, room.section)[index];
    if (!period) {
      out.push(
        <td
          key={`r-${room.id}`}
          className={`${CELL_CLASS} bg-[var(--surface)]`}
        />,
      );
      continue;
    }

    const cell = cells.get(cellKey(date, room.id, period.position));
    if (!cell) {
      out.push(<td key={`r-${room.id}`} className={CELL_CLASS} />);
      continue;
    }

    const run: { room: Room; cell: GridCell }[] = [{ room, cell }];
    if (cell.kind === "genre" && cell.slot?.genreId != null) {
      while (i + 1 < columns.length) {
        const nextColumn = columns[i + 1];
        if (nextColumn.kind !== "room") break;
        if (nextColumn.room.section !== room.section) break;
        const nextPeriodOfRoom = periodsFor(
          table,
          date,
          nextColumn.room.section,
        )[index];
        if (!nextPeriodOfRoom) break;
        const nextCell = cells.get(
          cellKey(date, nextColumn.room.id, nextPeriodOfRoom.position),
        );
        if (
          !nextCell ||
          nextCell.kind !== "genre" ||
          nextCell.slot?.genreId !== cell.slot.genreId
        ) {
          break;
        }
        run.push({ room: nextColumn.room, cell: nextCell });
        i += 1;
      }
    }

    const face = cellFace(cell);
    const clickable = run.some(
      (entry) => entry.cell.kind !== "none" && entry.cell.kind !== "partial",
    );
    const targets: PaintTarget[] = run.map((entry) => ({
      date,
      room: entry.room,
      period,
      cell: entry.cell,
    }));
    const roomLabel = run.map((entry) => entry.room.name).join(" + ");

    out.push(
      <td key={`r-${room.id}`} colSpan={run.length} className={CELL_CLASS}>
        <button
          type="button"
          disabled={disabled || !clickable}
          onClick={(event) => onCell(event, targets)}
          title={`${formatDateLabel(date)} ${formatTimeRange(period.startTime, period.endTime)} ${roomLabel} — ${face.title}`}
          aria-label={`${formatDateLabel(date)} ${formatTimeRange(period.startTime, period.endTime)} ${roomLabel} ${face.title}`}
          className="relative h-6 w-full cursor-pointer text-[11px] font-bold disabled:cursor-default"
          style={{ backgroundColor: face.bg, color: face.fg }}
        >
          {/*
            ①で取り込んだ予約を裏に薄く敷く (v1.29)。
            コマの時間を直すときに、何時から何時まで借りているのかが
            見えていないと直しようがない。コマの時間を変えると帯も伸び縮みする
          */}
          {face.bg === "transparent"
            ? cell.coverage.map((bar, barIndex) => (
                <span
                  key={barIndex}
                  aria-hidden
                  className="absolute inset-y-0"
                  style={{
                    left: `${bar.left}%`,
                    width: `${bar.width}%`,
                    backgroundColor: "var(--grid-reserved)",
                  }}
                />
              ))
            : null}
          <span className="relative">{face.text}</span>
        </button>
      </td>,
    );
  }

  return out;
}

/**
 * 時間の列を直す窓 (SPEC §6.2 Step2-2 / v1.29)
 *
 * 例外は**日にち単位でも建物単位でも起きる**ので、直した内容を
 * どこまで広げるかをその場で選ばせる。表のセルを1つずつ直させると、
 * 「アリーナだけ毎回30分遅い」月に13日ぶん同じ操作をすることになる。
 */
function TimeEditor({
  x,
  y,
  date,
  section,
  index,
  table,
  dates,
  sections,
  onSave,
  onClose,
}: {
  x: number;
  y: number;
  date: DateString;
  section: string;
  index: number;
  table: PeriodTable;
  dates: readonly DateString[];
  sections: readonly string[];
  onSave: (edits: PeriodEdit[]) => void;
  onClose: () => void;
}) {
  const current = periodsFor(table, date, section)[index];
  const [startTime, setStartTime] = useState(current?.startTime ?? "");
  const [endTime, setEndTime] = useState(current?.endTime ?? "");

  const input =
    "w-[5rem] rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm tabular-nums outline-none focus:border-[var(--foreground)]";

  /** 指定の (日,所在) のコマ列に、この行だけ差し替えたものを返す */
  function edited(targetDate: DateString, targetSection: string): SlotPeriod[] {
    const periods = periodsFor(table, targetDate, targetSection);
    const next = periods.map((period, i) =>
      i === index ? { ...period, startTime, endTime } : period,
    );
    // その所在にこの行が無ければ足す (コマ数が少ない所在に合わせる)
    if (!periods[index]) {
      next.push({ position: index + 1, startTime, endTime });
    }
    return renumber(next);
  }

  const button =
    "w-full rounded-lg border border-[var(--border)] px-3 py-1.5 text-left text-xs";

  return (
    <>
      <button
        type="button"
        aria-label="閉じる"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="コマの時間を直す"
        className="fixed z-50 w-60 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 shadow-lg"
        style={{
          left: Math.min(x, (globalThis.innerWidth ?? 800) - 260),
          top: Math.min(y, (globalThis.innerHeight ?? 600) - 280),
        }}
      >
        <p className="text-[11px] text-[var(--muted)]">
          {formatDateLabel(date)} / {section} / {index + 1}コマ目
        </p>

        <div className="flex items-center gap-1">
          <input
            aria-label="開始時刻"
            value={startTime}
            inputMode="numeric"
            onChange={(e) => setStartTime(normalizeTimeInput(e.target.value))}
            onBlur={(e) => setStartTime(finalizeTimeInput(e.target.value))}
            className={input}
          />
          <span className="text-sm">〜</span>
          <input
            aria-label="終了時刻"
            value={endTime}
            inputMode="numeric"
            onChange={(e) => setEndTime(normalizeTimeInput(e.target.value))}
            onBlur={(e) => setEndTime(finalizeTimeInput(e.target.value))}
            className={input}
          />
        </div>

        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onSave([{ date, section, periods: edited(date, section) }])}
            className={`${button} bg-[var(--primary)] font-bold text-[var(--primary-fg)]`}
          >
            この日のこの場所だけ
          </button>
          <button
            type="button"
            onClick={() =>
              onSave(
                dates.map((d) => ({
                  date: d,
                  section,
                  periods: edited(d, section),
                })),
              )
            }
            className={button}
          >
            {section} の全部の日に
          </button>
          <button
            type="button"
            onClick={() =>
              onSave(
                sections.map((s) => ({
                  date,
                  section: s,
                  periods: edited(date, s),
                })),
              )
            }
            className={button}
          >
            この日の全部の場所に
          </button>
          <button
            type="button"
            onClick={() =>
              onSave([{ date, section, periods: [...table.base] }])
            }
            className={`${button} text-[var(--danger-fg)]`}
          >
            基準に戻す
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * いま置くもの (SPEC §6.2 Step2 / v1.28)
 *
 * 1か月ぶんで数十セルを埋めるので、**1セルごとに窓を開かせない**。
 * 置くものを1つ選んでおけば、あとはセルを叩くだけで進む
 * (Excel でコピー&貼り付けを繰り返すのと同じ手数)。
 */
function BrushPalette({
  brush,
  onChange,
  disabled,
}: {
  brush: Brush | null;
  onChange: (brush: Brush | null) => void;
  disabled: boolean;
}) {
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 ${
      active
        ? "border-[var(--primary)] bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
        : "border-[var(--border)]"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border)] p-2">
      <span className="mr-1 text-xs font-bold">いま置くもの</span>

      {GENRES.map((genre) => {
        const active = brush?.kind === "genre" && brush.genreId === genre.id;
        return (
          <button
            key={genre.id}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() =>
              onChange(active ? null : { kind: "genre", genreId: genre.id })
            }
            className={`rounded-full border px-2.5 py-1 text-xs font-bold disabled:opacity-50 ${
              active ? "border-transparent" : "border-[var(--border)]"
            }`}
            style={
              active
                ? {
                    backgroundColor: GENRE_COLORS[genre.code].bg,
                    color: GENRE_COLORS[genre.code].fg,
                  }
                : undefined
            }
          >
            {genre.code}
          </button>
        );
      })}

      <span className="mx-1 h-4 w-px bg-[var(--border)]" />

      <button
        type="button"
        disabled={disabled}
        aria-pressed={brush?.kind === "open"}
        onClick={() =>
          onChange(brush?.kind === "open" ? null : { kind: "open" })
        }
        title="この時間だけを個人練に開放したいときに使います。未割当 (薄い○) のままでも、公開すれば通しで空きになります"
        className={chip(brush?.kind === "open")}
      >
        空き ○
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={brush?.kind === "unavailable"}
        onClick={() =>
          onChange(
            brush?.kind === "unavailable" ? null : { kind: "unavailable" },
          )
        }
        className={chip(brush?.kind === "unavailable")}
      >
        使用不可 −
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={brush?.kind === "clear"}
        onClick={() =>
          onChange(brush?.kind === "clear" ? null : { kind: "clear" })
        }
        className={chip(brush?.kind === "clear")}
      >
        消す
      </button>

      {brush ? (
        <span className="ml-auto text-xs text-[var(--muted)]">
          セルを押すと <strong>{brushLabel(brush)}</strong> が入ります (Esc で解除)
        </span>
      ) : (
        <span className="ml-auto text-xs text-[var(--muted)]">
          選ばずにセルを押すと、その場で選べます
        </span>
      )}
    </div>
  );
}

/** セルを直接押したときに出る小さな選択肢。選んだものはパレットにも残る */
function CellMenu({
  x,
  y,
  targets,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  targets: PaintTarget[];
  onPick: (brush: Brush) => void;
  onClose: () => void;
}) {
  const first = targets[0];
  return (
    <>
      <button
        type="button"
        aria-label="閉じる"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="このコマに置くもの"
        className="fixed z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--background)] p-2 shadow-lg"
        style={{
          left: Math.min(x, (globalThis.innerWidth ?? 800) - 240),
          top: Math.min(y, (globalThis.innerHeight ?? 600) - 260),
        }}
      >
        <p className="px-1 pb-1 text-[11px] text-[var(--muted)]">
          {formatDateLabel(first.date)}{" "}
          {formatTimeRange(first.period.startTime, first.period.endTime)}
          <br />
          {targets.map((t) => t.room.name).join(" + ")}
        </p>
        <div className="flex flex-wrap gap-1">
          {GENRES.map((genre) => (
            <button
              key={genre.id}
              type="button"
              onClick={() => onPick({ kind: "genre", genreId: genre.id })}
              className="rounded px-1.5 py-1 text-[11px] font-bold"
              style={{
                backgroundColor: GENRE_COLORS[genre.code].bg,
                color: GENRE_COLORS[genre.code].fg,
              }}
            >
              {genre.code}
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={() => onPick({ kind: "open" })}
            className="flex-1 rounded border border-[var(--border)] py-1 text-[11px]"
          >
            空き ○
          </button>
          <button
            type="button"
            onClick={() => onPick({ kind: "unavailable" })}
            className="flex-1 rounded border border-[var(--border)] py-1 text-[11px]"
          >
            使用不可 −
          </button>
          <button
            type="button"
            onClick={() => onPick({ kind: "clear" })}
            className="flex-1 rounded border border-[var(--border)] py-1 text-[11px]"
          >
            消す
          </button>
        </div>
      </div>
    </>
  );
}

/** 表の下の集計。各ジャンルへ配る前に必ず要る数字 (§6.2 Step2-2) */
function Totals({ totals }: { totals: ReturnType<typeof summarize> }) {
  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <p className="text-sm">
        <span className="font-bold">この月の練習コマ</span>{" "}
        <strong className="text-base tabular-nums">{totals.practicable}</strong>{" "}
        コマ / 合計{" "}
        <strong className="text-base tabular-nums">
          {formatMinutes(totals.minutes)}
        </strong>
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        未割当 {totals.unassigned} ・ 空き {totals.open} ・ 公式練{" "}
        {totals.genre} ・ 使用不可 {totals.unavailable}
        {totals.partial > 0 ? ` ・ 時間ズレ ${totals.partial}` : ""}
      </p>

      {totals.byGenre.size > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GENRES.map((genre) => {
            const count = totals.byGenre.get(genre.id) ?? 0;
            if (count === 0) return null;
            return (
              <span
                key={genre.id}
                className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{
                  backgroundColor: GENRE_COLORS[genre.code].bg,
                  color: GENRE_COLORS[genre.code].fg,
                }}
              >
                {genre.code} {count}
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function Legend() {
  return (
    <div className="space-y-1 text-xs text-[var(--muted)]">
      <p>
        薄い ○=練習できる(未割当) ／ 地の付いた ○=空き ／ −=使用不可 ／
        △=予約はあるがコマの時間を覆えていない ／ 空欄=予約なし。
        色付きのセルは公式練です。
        <strong>セルの裏の薄い帯</strong>は①で取り込んだ予約で、
        コマの時間を変えると伸び縮みします。
      </p>
      <p>
        <strong>時間割の列を押すと、その日・その建物のコマの時間を直せます。</strong>
        青い時間は基準と違う日です。日付の行の ＋ − でその日のコマ数を増減できます。
      </p>
      {/*
        「空き」を1コマずつ置くと、空きコマがコマ単位に切れる。
        通しで置きたいのが普通なので、未割当のままにしておくよう促す
        (公開時に unassignedRanges() が予約枠の余りを1本にまとめる)。
      */}
      <p>
        <strong>未割当 (薄い ○) はそのままで構いません。</strong>
        公開すると、その日の余った時間が<strong>通しで1本の「空き」</strong>になります。
        「空き」を1コマずつ置くと、空きがコマ単位に切れて、
        コマをまたぐ個人練の申請ができなくなります。
      </p>
    </div>
  );
}

/**
 * 基準のコマに合わないコマの一覧。
 *
 * **表に出ないものを黙って隠さない。** 表はコマの時間でしかセルを持てないので、
 * タイムラインで作った半端な時間のコマは行き場が無い。
 * ここに出しておかないと、公開して初めて気付くことになる。
 */
function OffGridNotice({
  offGrid,
  rooms,
}: {
  offGrid: {
    date: DateString;
    roomId: number;
    slot: { startTime: string; endTime: string };
  }[];
  rooms: readonly Room[];
}) {
  if (offGrid.length === 0) return null;
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  return (
    <section className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-fg)]">
      <p className="font-bold">
        コマの時間に合わないコマが {offGrid.length}件あります
      </p>
      <p className="mt-0.5">
        この表には出せません。「タイムライン」に切り替えると直せます。
      </p>
      <ul className="mt-1 space-y-0.5">
        {offGrid.slice(0, 8).map((entry, index) => (
          <li key={index}>
            {formatDateLabel(entry.date)}{" "}
            {roomById.get(entry.roomId)?.name ?? "?"}{" "}
            {formatTimeRange(entry.slot.startTime, entry.slot.endTime)}
          </li>
        ))}
        {offGrid.length > 8 ? <li>…ほか {offGrid.length - 8}件</li> : null}
      </ul>
    </section>
  );
}
