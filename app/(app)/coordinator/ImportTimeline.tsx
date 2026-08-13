"use client";

import {
  RESERVATION_BLOCK_COLOR,
  ROOMS,
  ROOM_BY_ID,
  shortRoomName,
} from "@/lib/constants";
import {
  DAY_END_TIME,
  DAY_START_TIME,
  formatDateLabel,
  formatTimeRange,
  fromMinutes,
  toMinutes,
} from "@/lib/time";

import type { Conflict, Row } from "./rows";

/**
 * 取込内容の確認タイムライン (SPEC.md §6.2 Step1-3 / v1.8)
 *
 * **縦=日付×部屋 / 横=時刻**。1ヶ月ぶんの取込を1画面で見渡せることが目的で、
 * 日付や時刻の読み取りミス・抜け・重複がひと目で分かるようにする。
 *
 * タブ①の DayGrid とは軸が逆 (あちらは1日ぶんを縦=時刻で描く)。
 * 確認画面は「1日を細かく見る」のではなく「月全体をざっと見る」ための画面なので、
 * 日付を縦に積んで時間軸を横に取るほうが目的に合う。
 *
 * 置けるのは rowError() が null の行だけ。時刻や部屋が確定しない行は
 * 呼び出し側が「要修正」カードとして別に並べる。
 */

/** 横方向の縮尺。1時間=60px。90分の枠でも '13:00〜14:30' が収まる */
const PX_PER_MINUTE = 1;
const LABEL_WIDTH = 104;
const ROW_HEIGHT = 26;

interface RoomLane {
  roomId: number;
  rows: Row[];
}

interface DayGroup {
  date: string;
  lanes: RoomLane[];
}

/** 日付順 → §4.2 の部屋順 に整える */
function groupRows(rows: Row[]): DayGroup[] {
  const byDate = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byDate.get(row.date);
    if (list) list.push(row);
    else byDate.set(row.date, [row]);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => {
      const byRoom = new Map<number, Row[]>();
      for (const row of dayRows) {
        const id = row.roomId as number;
        const list = byRoom.get(id);
        if (list) list.push(row);
        else byRoom.set(id, [row]);
      }
      return {
        date,
        lanes: ROOMS.filter((room) => byRoom.has(room.id)).map((room) => ({
          roomId: room.id,
          rows: byRoom.get(room.id) ?? [],
        })),
      };
    });
}

export function ImportTimeline({
  rows,
  conflicts,
  onSelect,
}: {
  rows: Row[];
  conflicts: Map<number, Conflict>;
  onSelect: (key: number) => void;
}) {
  if (rows.length === 0) return null;

  // 軸は 09:00〜22:00 を基本にしつつ、はみ出す枠があれば時間単位で広げる。
  // 端で切ると「読み取りミスで 08:00 になっている」ことに気付けなくなる
  const axisStart = Math.min(
    toMinutes(DAY_START_TIME),
    ...rows.map((r) => Math.floor(toMinutes(r.start) / 60) * 60),
  );
  const axisEnd = Math.max(
    toMinutes(DAY_END_TIME),
    ...rows.map((r) => Math.ceil(toMinutes(r.end) / 60) * 60),
  );
  const axisWidth = (axisEnd - axisStart) * PX_PER_MINUTE;

  const hours: number[] = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m);

  const groups = groupRows(rows);

  return (
    /*
     * 高さを 70vh で頭打ちにして中で縦スクロールさせる。
     * 全体を伸ばしたままだと**横スクロールバーが画面外の一番下に行ってしまい**、
     * 遅い時間帯を見るのにいちいちページ末尾まで送る必要があった。
     * ついでに時刻の目盛を sticky top-0 にできるので、縦に送っても軸を見失わない。
     */
    <div className="h-scroll max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]">
      <div className="w-max">
        {/* 時刻の目盛 */}
        <div className="sticky top-0 z-30 flex border-b border-[var(--border)] bg-[var(--surface)]">
          <div
            className="sticky left-0 z-20 shrink-0 bg-[var(--surface)]"
            style={{ width: LABEL_WIDTH }}
          />
          <div className="relative h-5" style={{ width: axisWidth }}>
            {hours.map((m) => (
              <span
                key={m}
                className="absolute top-0 text-[10px] text-[var(--muted)] tabular-nums"
                style={{ left: (m - axisStart) * PX_PER_MINUTE + 2 }}
              >
                {fromMinutes(m).slice(0, 2)}
              </span>
            ))}
          </div>
        </div>

        {groups.map((group) => (
          <div key={group.date}>
            <div className="flex border-t border-[var(--border)] bg-[var(--surface)]">
              <div
                className="sticky left-0 z-20 shrink-0 bg-[var(--surface)] px-2 py-1 text-xs font-bold"
                style={{ width: LABEL_WIDTH }}
              >
                {formatDateLabel(group.date)}
              </div>
              <div style={{ width: axisWidth }} />
            </div>

            {group.lanes.map((lane) => (
              <div
                key={lane.roomId}
                className="flex border-t border-[var(--border)]"
              >
                <div
                  className="sticky left-0 z-20 shrink-0 truncate bg-[var(--background)] px-2 text-[11px] leading-[26px] text-[var(--muted)]"
                  style={{ width: LABEL_WIDTH }}
                  title={ROOM_BY_ID.get(lane.roomId)?.name}
                >
                  {shortRoomName(ROOM_BY_ID.get(lane.roomId)?.name ?? "?")}
                </div>

                <div
                  className="relative bg-[var(--background)]"
                  style={{ width: axisWidth, height: ROW_HEIGHT }}
                >
                  {/* 1時間ごとの目盛線 */}
                  {hours.map((m) => (
                    <div
                      key={m}
                      className="absolute top-0 bottom-0 w-px bg-[var(--border)]"
                      style={{ left: (m - axisStart) * PX_PER_MINUTE }}
                    />
                  ))}

                  {lane.rows.map((row) => (
                    <Block
                      key={row.key}
                      row={row}
                      conflict={conflicts.get(row.key)}
                      axisStart={axisStart}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({
  row,
  conflict,
  axisStart,
  onSelect,
}: {
  row: Row;
  conflict: Conflict | undefined;
  axisStart: number;
  onSelect: (key: number) => void;
}) {
  const start = toMinutes(row.start);
  const end = toMinutes(row.end);
  const label = formatTimeRange(row.start, row.end);
  const roomName = ROOM_BY_ID.get(row.roomId as number)?.name ?? "";

  const warning =
    conflict === "duplicate"
      ? "同じ枠が重複しています (確定時に自動でスキップされます)"
      : conflict === "overlap"
        ? "同じ部屋で時間が重なっています。読み取りミスの可能性があります"
        : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(row.key)}
      title={`${roomName} ${label}${warning ? ` — ${warning}` : ""}`}
      className={`absolute top-0.5 bottom-0.5 overflow-hidden rounded px-1 text-left text-[10px] leading-[22px] whitespace-nowrap ${
        conflict ? "ring-2 ring-[#8B1A10]" : ""
      }`}
      style={{
        left: (start - axisStart) * PX_PER_MINUTE,
        width: Math.max((end - start) * PX_PER_MINUTE, 8),
        backgroundColor: RESERVATION_BLOCK_COLOR.bg,
        color: RESERVATION_BLOCK_COLOR.fg,
      }}
    >
      {conflict ? "⚠ " : ""}
      {label}
    </button>
  );
}
