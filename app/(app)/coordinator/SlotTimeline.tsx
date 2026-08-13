"use client";

import {
  GENRE_BY_ID,
  GENRE_COLORS,
  ROOM_BY_ID,
  SLOT_OPEN_COLOR,
  SLOT_UNAVAILABLE_COLOR,
  shortRoomName,
  type GenreCode,
} from "@/lib/constants";
import { SLOT_STATUS_LABELS, splitReservation, type SlotInfo } from "@/lib/slots";
import {
  DAY_END_TIME,
  DAY_START_TIME,
  formatDateLabel,
  formatTimeRange,
  fromMinutes,
  toMinutes,
} from "@/lib/time";

import type { ReservationInfo } from "./useMonthReservations";

/**
 * コマ割りタイムライン (SPEC.md §6.2 Step2 / v1.9)
 *
 * **縦=日付×部屋(予約枠) / 横=時刻**。Step1 の取込確認と同じ見方に揃えてある。
 * 予約枠を1つずつ開いて確認する形だと、月ぶんの埋め残しを把握するのに
 * 手数がかかりすぎた、という実運用の指摘による変更。
 *
 * 1レーン = 1予約枠。レーンの中身は splitReservation() が返す
 * 「コマ」と「未割当」で予約枠の範囲をちょうど覆う。
 *   - コマをタップ    → 編集
 *   - 未割当をタップ  → その時刻を開始としてコマ作成
 */

const PX_PER_MINUTE = 1;
const LABEL_WIDTH = 104;
const ROW_HEIGHT = 30;

function blockColor(slot: SlotInfo): { bg: string; fg: string } {
  if (slot.status === "open") return SLOT_OPEN_COLOR;
  if (slot.status === "unavailable") return SLOT_UNAVAILABLE_COLOR;
  const genre = slot.genreId !== null ? GENRE_BY_ID.get(slot.genreId) : null;
  return genre ? GENRE_COLORS[genre.code as GenreCode] : SLOT_OPEN_COLOR;
}

function blockLabel(slot: SlotInfo): string {
  if (slot.status === "genre") {
    const genre = slot.genreId !== null ? GENRE_BY_ID.get(slot.genreId) : null;
    return genre?.code ?? "公式練";
  }
  return SLOT_STATUS_LABELS[slot.status];
}

export function SlotTimeline({
  reservations,
  onSelectSlot,
  onSelectGap,
  onCancelReservation,
  disabled,
}: {
  reservations: ReservationInfo[];
  onSelectSlot: (reservation: ReservationInfo, slot: SlotInfo) => void;
  onSelectGap: (
    reservation: ReservationInfo,
    gap: { startTime: string; endTime: string },
  ) => void;
  onCancelReservation: (reservation: ReservationInfo) => void;
  disabled: boolean;
}) {
  if (reservations.length === 0) return null;

  // 軸は 09:00〜22:00 を基本に、はみ出す予約枠があれば時間単位で広げる
  const axisStart = Math.min(
    toMinutes(DAY_START_TIME),
    ...reservations.map((r) => Math.floor(toMinutes(r.startTime) / 60) * 60),
  );
  const axisEnd = Math.max(
    toMinutes(DAY_END_TIME),
    ...reservations.map((r) => Math.ceil(toMinutes(r.endTime) / 60) * 60),
  );
  const axisWidth = (axisEnd - axisStart) * PX_PER_MINUTE;

  const hours: number[] = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m);

  // 日付ごとにまとめる (useMonthReservations が date 順で返す)
  const groups: { date: string; items: ReservationInfo[] }[] = [];
  for (const reservation of reservations) {
    const last = groups[groups.length - 1];
    if (last && last.date === reservation.date) last.items.push(reservation);
    else groups.push({ date: reservation.date, items: [reservation] });
  }

  return (
    <div className="h-scroll max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]">
      <div className="w-max">
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

            {group.items.map((reservation) => (
              <div
                key={reservation.id}
                className="flex border-t border-[var(--border)]"
              >
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-center gap-1 bg-[var(--background)] pl-2"
                  style={{ width: LABEL_WIDTH, height: ROW_HEIGHT }}
                >
                  <span
                    className="truncate text-[11px] text-[var(--muted)]"
                    title={ROOM_BY_ID.get(reservation.roomId)?.name}
                  >
                    {shortRoomName(ROOM_BY_ID.get(reservation.roomId)?.name ?? "?")}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onCancelReservation(reservation)}
                    aria-label={`${formatDateLabel(reservation.date)} ${ROOM_BY_ID.get(reservation.roomId)?.name} の予約枠を取り消す`}
                    title="この予約枠を取り消す"
                    className="ml-auto mr-1 shrink-0 rounded px-1 text-xs text-[var(--muted)]"
                  >
                    ✕
                  </button>
                </div>

                <div
                  className="relative bg-[var(--background)]"
                  style={{ width: axisWidth, height: ROW_HEIGHT }}
                >
                  {hours.map((m) => (
                    <div
                      key={m}
                      className="absolute top-0 bottom-0 w-px bg-[var(--border)]"
                      style={{ left: (m - axisStart) * PX_PER_MINUTE }}
                    />
                  ))}

                  {splitReservation(reservation, reservation.slots).map(
                    (segment) => {
                      const left =
                        (toMinutes(segment.startTime) - axisStart) *
                        PX_PER_MINUTE;
                      const width = Math.max(
                        (toMinutes(segment.endTime) -
                          toMinutes(segment.startTime)) *
                          PX_PER_MINUTE,
                        10,
                      );
                      const range = formatTimeRange(
                        segment.startTime,
                        segment.endTime,
                      );

                      if (segment.kind === "unassigned") {
                        return (
                          <button
                            key={`gap-${segment.startTime}`}
                            type="button"
                            disabled={disabled}
                            onClick={() => onSelectGap(reservation, segment)}
                            title={`${range} 未割当 — タップしてコマを作る`}
                            className="absolute top-0.5 bottom-0.5 overflow-hidden rounded border border-dashed border-[var(--muted)] text-[10px] whitespace-nowrap text-[var(--muted)]"
                            style={{ left, width }}
                          >
                            ＋
                          </button>
                        );
                      }

                      const slot = segment.slot;
                      const color = blockColor(slot);
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => onSelectSlot(reservation, slot)}
                          title={`${range} ${blockLabel(slot)}${slot.published ? " (公開済)" : " (下書き)"}${slot.claims.length ? ` / 申請${slot.claims.length}件` : ""}`}
                          className={`absolute top-0.5 bottom-0.5 overflow-hidden rounded px-1 text-left text-[10px] leading-[24px] whitespace-nowrap ${
                            slot.published ? "" : "opacity-60 outline-2 outline-dashed outline-[var(--muted)] -outline-offset-2"
                          }`}
                          style={{
                            left,
                            width,
                            backgroundColor: color.bg,
                            color: color.fg,
                          }}
                        >
                          {blockLabel(slot)}
                          {slot.claims.length > 0 ? ` ●${slot.claims.length}` : ""}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
