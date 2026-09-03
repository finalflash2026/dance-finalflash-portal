import { appHost } from "@/lib/env";
import { eventEndDate } from "@/lib/day-span";
import type { MyEvent } from "@/lib/types";

/**
 * ics (iCalendar) 生成 (SPEC.md §10 / RFC 5545)
 *
 * 守るべき要点:
 *   - 改行は CRLF
 *   - 1行 75 **オクテット** で折り返し、継続行は行頭に空白1つ
 *     (日本語を含むので文字数ではなくバイト数で数える。マルチバイト文字の
 *      途中で折らないよう、コードポイント境界でのみ分割する)
 *   - `\` `;` `,` 改行 をエスケープ
 *   - **UID は恒久固定**。同じ予定は毎回同じ UID で出す。
 *     ここが変わると購読側で予定が重複する = 最重要ルール
 *   - DTSTART/DTEND は TZID=Asia/Tokyo のローカル時刻形式
 *
 * 予定の削除は「次回生成に含めない」ことで購読側から消える (差分管理は不要)。
 */

const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** MyEvent.kind → UID の接頭辞 (SPEC §10) */
const UID_PREFIX: Record<MyEvent["kind"], string> = {
  genre: "slot",
  claim: "claim",
  number: "numev",
  // スタ練 (v1.23)。**他と重ならない接頭辞にすること** —
  // UID がぶつかると購読側で別の予定に上書きされる
  studio: "gprac",
};

export function buildCalendar(events: MyEvent[], username: string): string {
  const host = appHost();
  const dtstamp = utcStamp(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//dance-circle-portal//JP",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`ダンス練習(${username})`)}`,
    `X-WR-TIMEZONE:Asia/Tokyo`,
    ...VTIMEZONE_JST,
    ...events.flatMap((event) => buildEvent(event, host, dtstamp)),
    "END:VCALENDAR",
  ];

  // 末尾にも CRLF を付けて終端する
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Asia/Tokyo は +0900 固定でサマータイムが無いため STANDARD のみ (SPEC §10) */
const VTIMEZONE_JST = [
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Tokyo",
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0900",
  "TZOFFSETTO:+0900",
  "TZNAME:JST",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function buildEvent(event: MyEvent, host: string, dtstamp: string): string[] {
  const uid = `${UID_PREFIX[event.kind]}-${event.sourceId}@${host}`;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=Asia/Tokyo:${localStamp(event.date, event.startTime)}`,
    // **終了は「終わる日」で書く** (v1.21)。23:00〜翌06:00 のような予定を
    // 同じ日付で書くと、終了が開始より前になり、カレンダーアプリ側で
    // 予定が消えるか長さ0として扱われる
    `DTEND;TZID=Asia/Tokyo:${localStamp(
      eventEndDate(event.date, event.startTime, event.endTime),
      event.endTime,
    )}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.location) {
    lines.push(`LOCATION:${escapeText(event.location)}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

/** 'YYYY-MM-DD' + 'HH:MM' → '20260806T130000' (ローカル時刻形式) */
function localStamp(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

/** DTSTAMP 用の UTC 表記 '20260811T031500Z' */
function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * TEXT 値のエスケープ (RFC 5545 3.3.11)。
 * バックスラッシュを最初に処理しないと二重エスケープになる。
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * 75 オクテットで行を折り返す (RFC 5545 3.1)。
 * 継続行は先頭に空白1つが入るため、2行目以降の中身は 74 オクテットまで。
 * for...of は**コードポイント単位**で回るので、UTF-8 の途中では割れない。
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  let limit = MAX_OCTETS;

  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    if (currentOctets + size > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_OCTETS - 1; // 継続行の先頭空白ぶん
    }
    current += char;
    currentOctets += size;
  }
  parts.push(current);

  return parts.join(`${CRLF} `);
}
