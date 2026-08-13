/**
 * CSV ファイルのパース (SPEC.md §9.2 / §9.4)
 *
 * papaparse に依存するのはこのファイルだけ。検証ルール本体は lib/import.ts にあり、
 * 確認画面 (クライアント) からも共用する。分けているのは、確認画面のバンドルに
 * papaparse を持ち込まないため。
 */

import Papa from "papaparse";

import {
  CSV_HEADER,
  CSV_HEADER_LINE,
  type ParsedRow,
  validateRow,
} from "@/lib/import";

export interface ParsedFile {
  filename: string;
  rows: ParsedRow[];
  /**
   * 全列が空だったため読み飛ばした行数 (SPEC §8.4 の skipped)。
   *
   * 完全な空行と末尾の改行は papaparse の skipEmptyLines が先に落とすので
   * ここには入らない。数えるのは `,,,` のように**列は揃っているが中身が無い行**
   * ——つまり AI が出力し損ねた行で、報告する価値があるのはこちら。
   */
  skipped: number;
  /** ヘッダ不正など、ファイル全体を扱えない致命的エラー */
  error: string | null;
}

/** UTF-8 BOM を落とす。付いたままだと先頭ヘッダが "﻿date" になる (SPEC §9.2) */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const HEADER_ERROR = `ヘッダが違います。1行目を「${CSV_HEADER_LINE}」にしてください`;

/**
 * CSV 1ファイルを解析する。
 *
 * ヘッダ不正はファイル単位のエラー。行単位の不備は `row.error` に入れて返し、
 * **1行の不備で全体を落とさない** (SPEC §8.4)。
 *
 * ヘッダの並び順は問わない (4列がちょうど揃っていればよい)。
 * AI の出力は列順が揺れることがあり、順序まで縛ると再生成のやり直しになるため。
 */
export function parseCsv(filename: string, text: string): ParsedFile {
  const result = Papa.parse<Record<string, string | undefined>>(stripBom(text), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const fields = result.meta.fields ?? [];
  const expected = new Set<string>(CSV_HEADER);
  const headerOk =
    fields.length === expected.size && fields.every((f) => expected.has(f));
  if (!headerOk) {
    return { filename, rows: [], skipped: 0, error: HEADER_ERROR };
  }

  const rows: ParsedRow[] = [];
  let skipped = 0;

  for (const record of result.data) {
    // 中身が無い行は「読み飛ばした」として数え、エラーにはしない
    const blank = CSV_HEADER.every((key) => !(record[key] ?? "").trim());
    if (blank) {
      skipped += 1;
      continue;
    }
    rows.push(validateRow(record));
  }

  return { filename, rows, skipped, error: null };
}
