/**
 * 日付・時刻ユーティリティ (SPEC.md §2 / §12)
 *
 * **設計方針**: 'YYYY-MM-DD' / 'HH:MM' の文字列のまま計算し、Date を経由しない。
 * ローカルタイムゾーンでの Date パースは UTC 変換で日付が前後にズレるため、
 * SPEC §2「DBは date / time 型で保持し、UTC変換で日付ズレを起こさないこと」を
 * 満たすには文字列演算が最も安全。
 *
 * 例外的に Date を使うのは以下2箇所のみで、いずれもタイムゾーン非依存:
 *   - todayInTokyo(): Intl の timeZone: 'Asia/Tokyo' で明示的に JST の今日を得る
 *   - getWeekday(): Date.UTC で構築し getUTCDay() で読む (ローカル TZ が絡まない)
 */

import type { DateString, TimeString } from "@/lib/types";

export const TIMEZONE = "Asia/Tokyo";

/** タブ①のタイムライン表示範囲 (SPEC §6.1: 09:00〜22:00) */
export const DAY_START_TIME: TimeString = "09:00";
export const DAY_END_TIME: TimeString = "22:00";
/** タイムラインの目盛 (SPEC §6.1: 30分刻み) */
export const TIMELINE_STEP_MINUTES = 30;
/**
 * 空き申請の時間粒度 (SPEC §6.1: 10分刻み。v1.7 で 15分から変更)
 * DB 側も claims_ten_minutes CHECK 制約で同じ粒度を強制している。
 * ここを変えるときはマイグレーションも必ず合わせること。
 */
export const CLAIM_STEP_MINUTES = 10;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// ---------- 時刻 ----------

/** DB の time 型は 'HH:MM:SS' で返るため 'HH:MM' に丸める */
export function normalizeTime(time: string): TimeString {
  return time.slice(0, 5);
}

/** 'HH:MM' → 0時からの経過分 */
export function toMinutes(time: string): number {
  const [h, m] = normalizeTime(time).split(":");
  return Number(h) * 60 + Number(m);
}

/** 0時からの経過分 → 'HH:MM' */
export function fromMinutes(minutes: number): TimeString {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** step 分単位に丸める (既定は空き申請の刻み) */
export function roundToStep(
  time: string,
  step: number = CLAIM_STEP_MINUTES,
  mode: "nearest" | "up" | "down" = "nearest",
): TimeString {
  const minutes = toMinutes(time);
  const fn =
    mode === "up" ? Math.ceil : mode === "down" ? Math.floor : Math.round;
  return fromMinutes(fn(minutes / step) * step);
}

/** time が step 分刻みちょうどか (申請時のバリデーション用) */
export function isOnStep(time: string, step: number = CLAIM_STEP_MINUTES) {
  return toMinutes(time) % step === 0;
}

/** 2つの時間帯が重なるか (端点の一致は重なりとみなさない) */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

/** '13:00〜14:50' (SPEC §12) */
export function formatTimeRange(start: string, end: string): string {
  return `${normalizeTime(start)}〜${normalizeTime(end)}`;
}

// ---------- 日付 ----------

/** JST の今日を 'YYYY-MM-DD' で返す */
export function todayInTokyo(): DateString {
  // en-CA ロケールは 'YYYY-MM-DD' 形式を返す
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(
    new Date(),
  );
}

/** JST の現在時刻を 'HH:MM' で返す */
export function nowTimeInTokyo(): TimeString {
  return formatAsTokyoTime(new Date());
}

/**
 * timestamptz (ISO文字列) や Date を JST の 'HH:MM' で表示する。
 * 施錠ボードの最終更新表示・最終取得表示に使う (SPEC §6.1.1)。
 */
export function formatAsTokyoTime(value: string | Date): TimeString {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function parseDate(date: DateString): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function formatDate(year: number, month: number, day: number): DateString {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 'YYYY-MM-DD' が実在する日付か。
 * 形式が合っていても 2026-02-30 のような値は DB の date 型が拒否するため、
 * CSV 取込では**保存前にここで弾いて行単位のエラーとして返す** (SPEC §9.4)。
 */
export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { year, month, day } = parseDate(date);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** 曜日番号 (0=日 … 6=土)。UTC で構築するのでローカル TZ の影響を受けない */
export function getWeekday(date: DateString): number {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** '8/6(木)' (SPEC §12) */
export function formatDateLabel(date: DateString): string {
  const { month, day } = parseDate(date);
  return `${month}/${day}(${WEEKDAY_LABELS[getWeekday(date)]})`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 月初 'YYYY-MM-01' */
export function startOfMonth(date: DateString): DateString {
  const { year, month } = parseDate(date);
  return formatDate(year, month, 1);
}

/** 月末 'YYYY-MM-末日' */
export function endOfMonth(date: DateString): DateString {
  const { year, month } = parseDate(date);
  return formatDate(year, month, daysInMonth(year, month));
}

/** 月を加減した同月1日を返す (ミニカレンダーの月送り用) */
export function addMonths(date: DateString, diff: number): DateString {
  const { year, month } = parseDate(date);
  const total = year * 12 + (month - 1) + diff;
  return formatDate(Math.floor(total / 12), (total % 12) + 1, 1);
}

/** 日を加減する (ics の取得範囲計算など) */
export function addDays(date: DateString, diff: number): DateString {
  const { year, month, day } = parseDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + diff));
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
