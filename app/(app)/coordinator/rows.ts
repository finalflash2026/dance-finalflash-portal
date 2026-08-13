/**
 * 確認画面の行モデルと判定 (SPEC.md §6.2 Step1-3)
 *
 * ImportStep (要修正カード・確定) と ImportTimeline (グリッド描画) の両方が使う。
 * 「タイムラインに置ける行」と「要修正の行」の線引きがズレると、
 * どちらにも出ない行や二重に出る行ができてしまうため、判定はここに集約する。
 */

import { ROOM_BY_ID } from "@/lib/constants";
import { validateRow } from "@/lib/import";
import { toMinutes } from "@/lib/time";

export interface Row {
  /** React の key。行を消しても番号が振り直されないよう独立に持つ */
  key: number;
  importFileId: string | null;
  date: string;
  start: string;
  end: string;
  roomRaw: string;
  roomId: number | null;
}

/**
 * 部屋名の生表記。空なら選んだ部屋の正式名で補う。
 * 手動で追加した行には元の表記が無いが、その場合の正式名は
 * 既に room_aliases 相当として解決できるのでエイリアス学習は起きない。
 */
export function effectiveRoomRaw(row: Row): string {
  const raw = row.roomRaw.trim();
  if (raw) return raw;
  return row.roomId !== null ? (ROOM_BY_ID.get(row.roomId)?.name ?? "") : "";
}

/**
 * サーバーの再検証と同じ判定。ここで赤く出た行はそのまま bulk でも弾かれる。
 * null 以外を返す行は**タイムラインに置けない**(時刻や部屋が確定しないため)ので、
 * 「要修正」カードとして別に並べる。
 */
export function rowError(row: Row): string | null {
  const checked = validateRow({
    date: row.date,
    start: row.start,
    end: row.end,
    room: effectiveRoomRaw(row),
  });
  if (checked.error) return checked.error;
  if (row.roomId === null) return "部屋を選んでください";
  return null;
}

/** 時間の重なり方 (SPEC §6.2 Step1-3 / v1.8) */
export type Conflict = "duplicate" | "overlap";

/**
 * 同一(日付・部屋)で時間が重なる行を洗い出す。
 *
 * 施設側で同じ部屋の同じ時間を二重に借りることはありえないので、
 * 重なっていたらAIの読み取りミスの可能性が高い。ただし**確定は妨げない** —
 * 折衝係が実物を見て判断できるほうがよいため、警告に留める。
 *
 * 完全一致は確定時に自動スキップされるので `duplicate` として区別し、
 * 「消さなくても大丈夫」と分かるようにする。
 */
export function findConflicts(rows: Row[]): Map<number, Conflict> {
  const result = new Map<number, Conflict>();
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const key = `${row.date}|${row.roomId}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) => toMinutes(a.start) - toMinutes(b.start),
    );

    // これまでで最も遅く終わる行を持ち回る。隣同士の比較だけだと
    // 長い枠 (9-18) に短い枠 (10-11 と 12-13) が入る形を取りこぼす
    let maxEnd = -1;
    let maxRow: Row | null = null;

    for (const row of sorted) {
      if (maxRow && toMinutes(row.start) < maxEnd) {
        const same =
          row.start === maxRow.start && row.end === maxRow.end
            ? "duplicate"
            : "overlap";
        // overlap のほうが強い警告なので上書きさせる
        if (same === "overlap" || !result.has(row.key)) result.set(row.key, same);
        if (same === "overlap" || !result.has(maxRow.key)) {
          result.set(maxRow.key, same);
        }
      }
      if (toMinutes(row.end) > maxEnd) {
        maxEnd = toMinutes(row.end);
        maxRow = row;
      }
    }
  }

  return result;
}
