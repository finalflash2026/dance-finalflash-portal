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

import { fromMinutes, normalizeTime, splitRange, toMinutes } from "@/lib/time";
import type { SlotStatus, TimeString } from "@/lib/types";

/** コマ長のプリセット (SPEC §6.2 Step2-3: 70分・90分・110分・手入力。v1.9で70分を追加) */
export const SLOT_PRESET_MINUTES = [70, 90, 110] as const;

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

/**
 * 編集中のコマ。
 *
 * **対象期は持たない。** v1.9 で対象期は月単位になり、ページ上部の設定が
 * その月の公式練コマすべてに適用されるため、コマ個別には選ばせない
 * (SPEC §6.2 Step2-2)。
 */
export interface SlotDraft {
  /** 編集中の既存コマ。重なり判定から自分自身を除くために使う */
  id: string | null;
  startTime: string;
  endTime: string;
  status: SlotStatus;
  genreId: number | null;
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
 * コマを伸ばせる限界 (SPEC §6.2 Step2-3)。
 * 予約枠の終わりか、次のコマの開始のうち早いほう。
 *
 * プリセット (70/90/110分) をここで頭打ちにしておけば、押した結果が
 * 必ず妥当な範囲になる。「押したら必ずエラーになるボタン」を作らないため。
 */
export function maxSlotEnd(
  reservation: TimeRange,
  slots: SlotInfo[],
  draftId: string | null,
  startMinutes: number,
): number {
  const nextStarts = slots
    .filter((s) => s.id !== draftId && toMinutes(s.startTime) >= startMinutes)
    .map((s) => toMinutes(s.startTime));
  return Math.min(toMinutes(reservation.endTime), ...nextStarts);
}

/**
 * プリセット (70/90/110分) を押したときの時間帯を決める。
 *
 * 新規作成の時刻欄は**空で開く** (予約枠の時間が入ったままだと打ち直しに
 * 一度消す手間がかかるため)。そのぶん、開始が空または書きかけのときは
 * 押した未割当区間の先頭を起点にして、1タップで開始・終了とも埋まるようにする。
 *
 * 終了は maxSlotEnd() で頭打ちにするので、返す範囲は常に妥当。
 */
export function applySlotPreset(
  reservation: TimeRange,
  slots: SlotInfo[],
  draft: Pick<SlotDraft, "id" | "startTime">,
  gapStart: TimeString,
  minutes: number,
): { startTime: TimeString; endTime: TimeString } {
  const typed = draft.startTime.trim();
  const startTime = TIME_RE.test(typed) ? typed : gapStart;
  const start = toMinutes(startTime);
  const limit = maxSlotEnd(reservation, slots, draft.id, start);
  return { startTime, endTime: fromMinutes(Math.min(start + minutes, limit)) };
}

/** 対象期の比較キー。null と空配列はどちらも「全期」として同一視する */
export function generationsKey(value: number[] | null): string {
  return value && value.length > 0
    ? [...value].sort((a, b) => a - b).join(",")
    : "";
}

/**
 * その月の公式練コマから対象期を読み取る (SPEC §6.2 Step2-2 / v1.9)。
 *
 * 対象期は月単位で決まるので、通常は全コマが同じ値を持つ。
 * v1.9 より前に作ったコマが混ざっていると食い違うことがあるため、
 * その場合は `mixed` を立てて画面で警告できるようにする。
 */
export function deriveMonthGenerations(slots: SlotInfo[]): {
  value: number[] | null;
  mixed: boolean;
  count: number;
} {
  const genreSlots = slots.filter((s) => s.status === "genre");
  if (genreSlots.length === 0) return { value: null, mixed: false, count: 0 };

  const first = generationsKey(genreSlots[0].targetGenerations);
  const mixed = genreSlots.some(
    (s) => generationsKey(s.targetGenerations) !== first,
  );
  return {
    value: mixed ? null : genreSlots[0].targetGenerations,
    mixed,
    count: genreSlots.length,
  };
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
