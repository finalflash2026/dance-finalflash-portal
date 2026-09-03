import { addDays, normalizeTime } from "@/lib/time";
import type { DateString, TimeString } from "@/lib/types";

/**
 * 日をまたぐ予定の扱い (SPEC.md §6.3 / v1.21)
 *
 * ナンバー練には `23:00〜翌06:00` のような夜通しの練習がある。
 * **終了が開始以前なら「翌日まで」と読む**という約束を、ここ1か所に閉じ込める。
 * 営業時間の書き方と同じ考え方で、DBに列を増やさずに済む。
 *
 * この判断が散らばると、片方の画面だけ翌日ぶんを描き忘れる、
 * ics の終了だけ前日のままになる、といったずれ方をする。
 * **日付をまたぐかどうかを見たい場所は、必ずここを通すこと。**
 */

/** 終了が開始以前なら翌日まで続く予定 */
export function spansMidnight(start: string, end: string): boolean {
  return normalizeTime(end) <= normalizeTime(start);
}

/** 予定が終わる日。またがなければ開始日と同じ */
export function eventEndDate(
  date: DateString,
  start: string,
  end: string,
): DateString {
  return spansMidnight(start, end) ? addDays(date, 1) : date;
}

/**
 * カレンダーに置くための断片。
 *
 * またぐ予定は**2日ぶんに割る**。1日目は開始〜24:00、2日目は00:00〜終了。
 * 縦のタイムラインは1日ぶんの高さしか持たないので、割らずに描くと
 * 1日目が画面外へはみ出し、2日目には何も出ない。
 */
export interface DaySegment {
  date: DateString;
  startTime: TimeString;
  endTime: TimeString;
  /** その日に閉じている / またぐ予定の前半 / 後半 */
  part: "whole" | "first" | "second";
}

const MIDNIGHT_START = "00:00" as TimeString;
const MIDNIGHT_END = "24:00" as TimeString;

export function splitAcrossMidnight(
  date: DateString,
  start: string,
  end: string,
): DaySegment[] {
  const startTime = normalizeTime(start);
  const endTime = normalizeTime(end);

  if (!spansMidnight(startTime, endTime)) {
    return [{ date, startTime, endTime, part: "whole" }];
  }

  return [
    { date, startTime, endTime: MIDNIGHT_END, part: "first" },
    {
      date: addDays(date, 1),
      startTime: MIDNIGHT_START,
      endTime,
      part: "second",
    },
  ];
}

/** 1日ぶんの断片と、元になった予定 */
export interface DayEntry<T> {
  date: DateString;
  /** その日に描く範囲 (またぐ予定は 24:00 で切られている) */
  startTime: TimeString;
  endTime: TimeString;
  part: DaySegment["part"];
  event: T;
}

/**
 * 予定の一覧を「日ごとの断片」に展開する。
 *
 * またぐ予定は2件になるので、**ミニカレンダーの印も両日に付く**。
 * 呼び出し側で `event.date` を直接見て日付ごとにまとめると、
 * 翌日ぶんが丸ごと落ちる。
 */
export function expandByDay<
  T extends { date: DateString; startTime: string; endTime: string },
>(events: readonly T[]): DayEntry<T>[] {
  return events.flatMap((event) =>
    splitAcrossMidnight(event.date, event.startTime, event.endTime).map(
      (segment) => ({ ...segment, event }),
    ),
  );
}

/**
 * またいだ断片に添える一言。**元の予定の時刻**を渡すこと
 * (断片側は 24:00 / 00:00 に切られているため)。
 *
 * これが無いと、翌朝の画面に 00:00 から始まる予定だけが現れて、
 * いつからの続きなのか分からない。
 */
export function spanNote(
  part: DaySegment["part"],
  start: string,
  end: string,
): string | null {
  if (part === "first") return `翌${normalizeTime(end)}まで`;
  if (part === "second") return `前日${normalizeTime(start)}から`;
  return null;
}

/**
 * 画面に出す時刻の範囲。またぐときは終了に「翌」を付ける。
 *
 * `23:00〜06:00` とだけ書くと、**どちらが先か読み手に判断させる**ことになる。
 * 深夜練は日付の感覚が曖昧になりやすいので、跨いだことを明示する。
 */
export function formatSpanRange(start: string, end: string): string {
  const startTime = normalizeTime(start);
  const endTime = normalizeTime(end);
  return spansMidnight(startTime, endTime)
    ? `${startTime}〜翌${endTime}`
    : `${startTime}〜${endTime}`;
}
