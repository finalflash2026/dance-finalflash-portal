import type { CSSProperties } from "react";

/**
 * 予定の見た目を Apple のカレンダーに寄せる (SPEC.md §12 / v1.50)
 *
 * 予定の色をそのまま塗ると、色の濃い板が並んで文字も読みにくい。Apple のカレンダーと同じく、
 * **地は予定の色を混ぜた色・文字は予定の色を濃くした色**にする。左端の色の線は付けない (v1.50.1)。
 * ライト・ダークのどちらでも読めるよう、背景色・文字色と混ぜて作る (color-mix)。
 *
 * 色は var(...) でもよい (空きコマの色はテーマで変わる)。
 */

/** 予定の色を混ぜた地 (時間表のブロック・月表示の時刻ありの予定)。v1.50.1 で 22% → 38% に強める */
export function eventTint(color: string): string {
  return `color-mix(in srgb, ${color} 38%, var(--cell))`;
}

/** 地の上の文字 (予定の色を文字色に寄せて、読める濃さにする) */
export function eventInk(color: string): string {
  return `color-mix(in srgb, ${color} 55%, var(--foreground))`;
}

/** 色を混ぜた地 + 濃い文字。時間表のブロックに使う */
export function eventBlockStyle(color: string): CSSProperties {
  return {
    backgroundColor: eventTint(color),
    color: eventInk(color),
  };
}
