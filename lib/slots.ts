/**
 * コマ割りの計算と検証 (SPEC.md §6.2 Step2)
 *
 * 第1層 reservations(予約枠) を第2層 slots(コマ) に割る際のルールを集約する。
 * 「エディタの表示」「保存前の検証」の両方がここを使う。両者がズレると
 * 「画面では作れたのに保存で落ちる」ことになるため。
 *
 * DB 側にも同じ制約がある (slots_no_overlap 排他制約 / start_time < end_time /
 * status='genre' なら genre_id 必須)。ここはその手前で分かりやすい日本語を
 * 出すためのもので、認可・整合性の最終防衛線ではない (SPEC §13.2)。
 */

import { normalizeTime, splitRange, toMinutes } from "@/lib/time";
import type { SlotStatus, TimeString } from "@/lib/types";

/** コマ長のプリセット (SPEC §6.2 Step2-2: 90分・110分・手入力) */
export const SLOT_PRESET_MINUTES = [90, 110] as const;

export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  genre: "公式練",
  open: "空き",
  unavailable: "使用不可",
};

export interface SlotClaimInfo {
  id: string;
  username: string;
  startTime: TimeString;
  endTime: TimeString;
}

export interface SlotInfo {
  id: string;
  startTime: TimeString;
  endTime: TimeString;
  status: SlotStatus;
  genreId: number | null;
  /** null = 全期対象 */
  targetGenerations: number[] | null;
  published: boolean;
  claims: SlotClaimInfo[];
}

export interface TimeRange {
  startTime: TimeString;
  endTime: TimeString;
}

/** 予約枠を「コマ」と「未割当」に割った1区間 */
export type SlotSegment =
  | ({ kind: "slot"; slot: SlotInfo } & TimeRange)
  | ({ kind: "unassigned" } & TimeRange);

/**
 * 予約枠をコマと未割当区間に分割する (SPEC §6.2 Step2-4)。
 * **未割当は DB 行を作らない**ので、ここで計算して画面に出すことが唯一の表現になる。
 */
export function splitReservation(
  reservation: TimeRange,
  slots: SlotInfo[],
): SlotSegment[] {
  return splitRange(reservation, slots).map((segment) =>
    segment.kind === "filled"
      ? {
          kind: "slot" as const,
          slot: segment.item,
          startTime: segment.startTime,
          endTime: segment.endTime,
        }
      : {
          kind: "unassigned" as const,
          startTime: segment.startTime,
          endTime: segment.endTime,
        },
  );
}

export interface SlotDraft {
  /** 編集中の既存コマ。重なり判定から自分自身を除くために使う */
  id: string | null;
  startTime: string;
  endTime: string;
  status: SlotStatus;
  genreId: number | null;
  targetGenerations: number[] | null;
}

export type SlotValidation = { ok: true } | { ok: false; message: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** SPEC §6.2 Step2-3 のバリデーション */
export function validateSlot(
  reservation: TimeRange,
  slots: SlotInfo[],
  draft: SlotDraft,
): SlotValidation {
  if (!TIME_RE.test(draft.startTime) || !TIME_RE.test(draft.endTime)) {
    return { ok: false, message: "時刻は HH:MM 形式で入力してください" };
  }

  const start = toMinutes(draft.startTime);
  const end = toMinutes(draft.endTime);
  if (end <= start) {
    return { ok: false, message: "終了時刻は開始時刻より後にしてください" };
  }

  if (
    start < toMinutes(reservation.startTime) ||
    end > toMinutes(reservation.endTime)
  ) {
    return {
      ok: false,
      message: `予約枠 (${normalizeTime(reservation.startTime)}〜${normalizeTime(reservation.endTime)}) の範囲内にしてください`,
    };
  }

  const conflict = slots.find(
    (slot) =>
      slot.id !== draft.id &&
      start < toMinutes(slot.endTime) &&
      toMinutes(slot.startTime) < end,
  );
  if (conflict) {
    return {
      ok: false,
      message: `${normalizeTime(conflict.startTime)}〜${normalizeTime(conflict.endTime)} のコマと重なっています`,
    };
  }

  if (draft.status === "genre" && draft.genreId === null) {
    return { ok: false, message: "公式練にはジャンルを選んでください" };
  }

  return { ok: true };
}

/**
 * 変更によって成り立たなくなる空き申請を返す (SPEC §6.2 Step3)。
 *
 * 「公開済コマを `open` から他へ変更する際、既にその時間帯に `claims` があれば
 * 警告を出し、続行時は該当 claim を削除して申請者名を表示する」を判定する。
 * コマの削除・予約枠の取消でも同じ判定を使う (どちらも申請が宙に浮くため)。
 *
 * `next` が null なら「コマごと消す」= 全ての申請が無効になる。
 */
export function invalidatedClaims(
  slot: SlotInfo,
  next: { status: SlotStatus; startTime: string; endTime: string } | null,
): SlotClaimInfo[] {
  if (next === null || next.status !== "open") return slot.claims;

  // 空きのままでも、範囲が縮んで申請がはみ出すなら成り立たない
  const start = toMinutes(next.startTime);
  const end = toMinutes(next.endTime);
  return slot.claims.filter(
    (claim) => toMinutes(claim.startTime) < start || end < toMinutes(claim.endTime),
  );
}
