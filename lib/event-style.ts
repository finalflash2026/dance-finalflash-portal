import type { CSSProperties } from "react";

/**
 * 予定の見た目を Apple のカレンダーに寄せる (SPEC.md §12 / v1.50)
 *
 * 予定の色をそのまま塗ると、色の濃い板が並んで文字も読みにくい。Apple のカレンダーと同じく、
 * **地は予定の色をうすく混ぜた色・左に濃い色の線・文字は予定の色を濃くした色**にする。
 * ライト・ダークのどちらでも読めるよう、背景色・文字色と混ぜて作る (color-mix)。
 *
 * 色は var(...) でもよい (空きコマの色はテーマで変わる)。
 */

/** うすい地 (時間表のブロック・月表示の時刻ありの予定) */
export function eventTint(color: string): string {
  return `color-mix(in srgb, ${color} 22%, var(--cell))`;
}

/** 地の上の文字 (予定の色を文字色に寄せて、読める濃さにする) */
export function eventInk(color: string): string {
  return `color-mix(in srgb, ${color} 62%, var(--foreground))`;
}

/** うすい地 + 左の線 + 濃い文字。時間表のブロックと終日の行に使う */
export function eventBlockStyle(color: string): CSSProperties {
  return {
    backgroundColor: eventTint(color),
    color: eventInk(color),
    boxShadow: `inset 3px 0 0 ${color}`,
  };
}
