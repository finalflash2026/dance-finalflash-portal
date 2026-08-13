/**
 * CSV 取込の検証ルールと部屋名正規化 (SPEC.md §9)
 *
 * **DB にも papaparse にも依存しない純粋関数だけを置く**。ここのルールは
 *   - `POST /api/import/parse` (アップロード直後の解析)
 *   - `POST /api/reservations/bulk` (確認画面で編集された行の再検証)
 *   - 確認画面 (入力するそばから赤表示する)
 * の3箇所が使う。どれか1つだけ緩いと「画面では通ったのに保存で落ちる」、
 * 逆に厳しいと「直しようのないエラーが出続ける」ことになるため必ず共用する。
 *
 * CSV のパース本体だけは papaparse に依存するので lib/csv.ts に分けてある。
 * **このファイルは依存を持たない**(確認画面のバンドルに papaparse も zod も
 * 持ち込まないため。検証は正規表現4つと大小比較だけで足りる)。
 *
 * 外部APIは一切呼ばない (SPEC §9.1 / §9.5: 取込コストは0円)。
 */

import { isValidDateString, toMinutes } from "@/lib/time";
import type { DateString, TimeString } from "@/lib/types";

/** SPEC §9.2 のヘッダ。この4列ちょうどでなければファイル単位でエラー */
export const CSV_HEADER = ["date", "start", "end", "room"] as const;
export const CSV_HEADER_LINE = CSV_HEADER.join(",");

/** SPEC §8.4: 1ファイル 2MB 以下 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 1リクエストあたりの上限。予約枠は月に数十件なので十分な余裕がある */
export const MAX_FILES_PER_REQUEST = 10;
export const MAX_ROWS_PER_REQUEST = 1000;

/** SPEC §9.3 の折衝係向けプロンプト。画面に常時表示してコピーさせる */
export const COORDINATOR_PROMPT = `添付は施設予約サイトの予約一覧のスクリーンショットです。
予約1件を1行として、次の形式のCSVだけを出力してください(説明文なし)。

date,start,end,room
規則:
- date は YYYY-MM-DD。和暦「令和N年」は西暦に変換(令和8年=2026年)。
- start / end は24時間表記 HH:MM のゼロ埋め。「13:00 〜 16:10」→ 13:00 と 16:10。
- room は部屋名のみ(会館名「八王子市南大沢文化会館」等は除く)。
- ヘッダ行・ページャ・予約以外の行は無視。読み取れない行は出力しない。`;

// ---------- 部屋名の正規化 ----------

/**
 * 部屋名の照合キー。
 *
 * CSV は折衝係が各自のAIに作らせたもので、全角/半角の括弧・英数、
 * 余分な空白などが元ページと揺れる。素の文字列比較だと
 * 「アリーナＡ」「アリーナ A」が未知の部屋として毎回赤くなってしまうため、
 * NFKC で全角→半角に寄せ、空白を落として比較する。
 *
 * **保存する alias は正規化前の生文字列**にする。次回同じ表記が来たときは
 * どちらの経路でも一致するので、生のまま残しておくほうが監査で読みやすい。
 */
export function roomKey(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** alias / rooms.name → room_id の対応表。キーは roomKey() 済み */
export type RoomResolver = ReadonlyMap<string, number>;

/**
 * 部屋名の対応表を作る。
 * rooms.name も引けるようにしておく (「剣道場(体育館)」のように
 * エイリアスには無いが正規名そのものが書かれてくる場合があるため)。
 */
export function buildRoomResolver(
  rooms: { id: number; name: string }[],
  aliases: { alias: string; room_id: number }[],
): RoomResolver {
  const map = new Map<string, number>();
  for (const room of rooms) map.set(roomKey(room.name), room.id);
  // エイリアスを後勝ちにする (運用で上書きしたい場合に効かせるため)
  for (const alias of aliases) map.set(roomKey(alias.alias), alias.room_id);
  return map;
}

export function resolveRoom(
  resolver: RoomResolver,
  roomRaw: string,
): number | null {
  return resolver.get(roomKey(roomRaw)) ?? null;
}

// ---------- 行の検証 (SPEC §9.4) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 00:00〜23:59 のみ。DB の time 型は 24:00 も受けるが運用上ありえない */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 解析後の1行。error があっても捨てず、確認画面で赤表示して直させる */
export interface ParsedRow {
  date: DateString;
  start: TimeString;
  end: TimeString;
  roomRaw: string;
  /** 行単位の不備。null なら妥当 */
  error: string | null;
}

/** 最初に見つかった不備を返す。1行に複数あっても直す順は1つずつでよい */
function findError(row: {
  date: string;
  start: string;
  end: string;
  room: string;
}): string | null {
  if (!row.date) return "date が空です";
  if (!DATE_RE.test(row.date)) return "date は YYYY-MM-DD 形式にしてください";
  if (!isValidDateString(row.date)) return "存在しない日付です";

  if (!row.start) return "start が空です";
  if (!TIME_RE.test(row.start)) {
    return "start は HH:MM 形式 (00:00〜23:59) にしてください";
  }
  if (!row.end) return "end が空です";
  if (!TIME_RE.test(row.end)) {
    return "end は HH:MM 形式 (00:00〜23:59) にしてください";
  }
  if (toMinutes(row.start) >= toMinutes(row.end)) {
    return "start は end より前にしてください";
  }

  if (!row.room) return "room が空です";
  return null;
}

/**
 * 1行を検証する。**不備があっても値はそのまま返す**
 * (確認画面に元の入力を出して、その場で直せるようにするため)。
 */
export function validateRow(raw: {
  date?: string;
  start?: string;
  end?: string;
  room?: string;
}): ParsedRow {
  const row = {
    date: (raw.date ?? "").trim(),
    start: (raw.start ?? "").trim(),
    end: (raw.end ?? "").trim(),
    room: (raw.room ?? "").trim(),
  };

  return {
    date: row.date,
    start: row.start,
    end: row.end,
    roomRaw: row.room,
    error: findError(row),
  };
}

