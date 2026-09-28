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
  periodsForSection,
  summarize,
  type GridCell,
  type PeriodTable,
  type SlotPeriod,
} from "@/lib/slot-grid";
import { formatDateLabel, formatTimeRange } from "@/lib/time";
import type { DateString } from "@/lib/types";

import type { ReservationInfo } from "./useMonthReservations";

/**
 * コマ割り表 (SPEC.md §6.2 Step2 / v1.28)
 *
 * **折衝係が Excel で作っている表をそのまま画面にした**もの。
 * 列=練習場所(所在ごとにまとめる) / 行=日にち×コマ で、セルを押すと
 * そこに置くものを決められる。
 *
 * 表の向きを以前のタイムライン (縦=日付×部屋 / 横=時刻) から入れ替えたのは、
 * **折衝の手順そのものが「この表を埋めていく」作業**だから。
 * 見ている紙と画面の形が違うと、1セルごとに目を移し替えることになる。
 *
 * ○ は自動で出す。予約枠とコマの時間を突き合わせれば決まるので、
 * 折衝係が数えたり塗ったりする必要はない (lib/slot-grid.ts)。
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

const CELL_CLASS =
  "border border-[var(--border)] p-0 text-center align-middle";
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
        bg: "var(--danger-bg)",
        fg: "var(--danger-fg)",
        title:
          "予約はありますが、このコマの時間を覆えていません (予約時間とコマの時間がズレています)",
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
}: {
  dates: readonly DateString[];
  rooms: readonly Room[];
  table: PeriodTable;
  reservations: readonly ReservationInfo[];
  disabled: boolean;
  onPaint: (target: PaintTarget, brush: Brush) => void;
}) {
  const [brush, setBrush] = useState<Brush | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target: PaintTarget;
  } | null>(null);

  // 置くものを選んだままにしておくと事故のもとなので、Esc で必ず外せる
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) setMenu(null);
      else setBrush(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu]);

  const sections = groupRoomsBySection(rooms);
  const periodsFor = (section: string) => periodsForSection(table, section);
  const input = { dates, rooms, periodsFor, reservations };
  const { cells, offGrid } = buildGrid(input);
  const totals = summarize(input, cells);

  // 行数は一番コマが多い所在に合わせる (基準より多い上書きがあっても出す)
  const rowCount = Math.max(
    table.base.length,
    ...[...table.overrides.values()].map((list) => list.length),
    0,
  );

  /** 列の並び: 上書きのある所在の前に、その所在の時間列を差し込む */
  const columns: (
    | { kind: "time"; section: string }
    | { kind: "room"; room: Room }
  )[] = [];
  for (const group of sections) {
    if (table.overrides.has(group.section)) {
      columns.push({ kind: "time", section: group.section });
    }
    for (const room of group.rooms) columns.push({ kind: "room", room });
  }

  function handleCell(
    event: React.MouseEvent,
    target: PaintTarget,
  ) {
    if (brush) {
      onPaint(target, brush);
      return;
    }
    // まだ何も選んでいなければ、その場で選ばせる。
    // 選んだものはそのまま「いま置くもの」になり、次からは1クリックで置ける
    setMenu({ x: event.clientX, y: event.clientY, target });
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
                日付 / コマ
              </th>
              {sections.map((group) => (
                <th
                  key={group.section}
                  colSpan={
                    group.rooms.length +
                    (table.overrides.has(group.section) ? 1 : 0)
                  }
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
                  style={{ minWidth: column.kind === "time" ? 78 : 64 }}
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
            {dates.map((date) => (
              <Fragment key={date}>
                <tr>
                  <th
                    className={`${HEAD_CLASS} sticky left-0 z-20 text-left`}
                    colSpan={1}
                  >
                    {formatDateLabel(date)}
                  </th>
                  <td
                    colSpan={columns.length}
                    className="border border-[var(--border)] bg-[var(--surface)]"
                  />
                </tr>

                {Array.from({ length: rowCount }, (_, index) => {
                  const basePeriod = table.base[index] ?? null;
                  return (
                    <tr key={`${date}-${index}`}>
                      <th
                        className={`${HEAD_CLASS} sticky left-0 z-20 font-normal tabular-nums`}
                      >
                        {basePeriod
                          ? formatTimeRange(
                              basePeriod.startTime,
                              basePeriod.endTime,
                            )
                          : "—"}
                      </th>

                      {columns.map((column) => {
                        if (column.kind === "time") {
                          const period = periodsFor(column.section)[index];
                          return (
                            <td
                              key={`t-${column.section}`}
                              className={`${CELL_CLASS} bg-[var(--surface)] tabular-nums text-[var(--muted)]`}
                            >
                              {period
                                ? formatTimeRange(
                                    period.startTime,
                                    period.endTime,
                                  )
                                : ""}
                            </td>
                          );
                        }

                        const room = column.room;
                        const period = periodsFor(room.section)[index];
                        if (!period) {
                          return (
                            <td
                              key={`r-${room.id}`}
                              className={`${CELL_CLASS} bg-[var(--surface)]`}
                            />
                          );
                        }

                        const cell = cells.get(
                          cellKey(date, room.id, period.position),
                        );
                        if (!cell) return <td key={`r-${room.id}`} className={CELL_CLASS} />;

                        const face = cellFace(cell);
                        const clickable =
                          cell.kind !== "none" && cell.kind !== "partial";

                        return (
                          <td key={`r-${room.id}`} className={CELL_CLASS}>
                            <button
                              type="button"
                              disabled={disabled || !clickable}
                              onClick={(event) =>
                                handleCell(event, { date, room, period, cell })
                              }
                              title={`${formatDateLabel(date)} ${formatTimeRange(period.startTime, period.endTime)} ${room.name} — ${face.title}`}
                              aria-label={`${formatDateLabel(date)} ${formatTimeRange(period.startTime, period.endTime)} ${room.name} ${face.title}`}
                              className="h-6 w-full cursor-pointer text-[11px] font-bold disabled:cursor-default"
                              style={{
                                backgroundColor: face.bg,
                                color: face.fg,
                              }}
                            >
                              {face.text}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
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
          target={menu.target}
          onPick={(picked) => {
            setBrush(picked.kind === "clear" ? null : picked);
            onPaint(menu.target, picked);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
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
  target,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  target: PaintTarget;
  onPick: (brush: Brush) => void;
  onClose: () => void;
}) {
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
          {formatDateLabel(target.date)}{" "}
          {formatTimeRange(target.period.startTime, target.period.endTime)}
          <br />
          {target.room.name}
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
    <p className="text-xs text-[var(--muted)]">
      ○=練習できる(未割当。公開すると「空き」になります) ／ −=使用不可 ／
      △=予約はあるがコマの時間を覆えていない ／ 空欄=予約なし。
      色付きのセルは公式練です。
    </p>
  );
}

/**
 * 基準のコマに合わないコマの一覧。
 *
 * **表に出ないものを黙って隠さない。** 表は基準の時間でしかセルを持てないので、
 * 昔のタイムラインで作った半端な時間のコマは行き場が無い。
 * ここに出しておかないと、公開して初めて気付くことになる。
 */
function OffGridNotice({
  offGrid,
  rooms,
}: {
  offGrid: { date: DateString; roomId: number; slot: { startTime: string; endTime: string } }[];
  rooms: readonly Room[];
}) {
  if (offGrid.length === 0) return null;
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  return (
    <section className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-fg)]">
      <p className="font-bold">
        基準のコマに合わないコマが {offGrid.length}件あります
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
