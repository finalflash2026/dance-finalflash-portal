import type { CSSProperties } from "react";

/**
 * 予定の見た目 (SPEC.md §12 / v1.50 → v1.50.2)
 *
 * 予定の色をそのまま塗ると、色の濃い板が並んで文字も読みにくい。
 * **地は予定の色を混ぜた色・文字は予定の色を濃くした色**にする。左端の色の線は付けない (v1.50.1)。
 * ライト・ダークのどちらでも読めるよう、背景色・文字色と混ぜて作る (color-mix)。
 *
 * **割合は WCAG AA (4.5:1) を両テーマで満たす値にしてある** (v1.50.2)。ジャンル9色・ナンバー8色・
 * イベント・申請済みのすべてで、地 30% / 文字 35% はライト 5.07・ダーク 4.80 以上。
 * うすい予定 (他ジャンル・空き) は地を 14% にして見分ける。**透明度 (opacity) で薄めない** (文字まで薄くなるため)。
 * 割合を変えるときは、全部の色で計算し直すこと。
 *
 * 色は var(...) でもよい (空きコマの色はテーマで変わる)。
 */
const TINT = 30;
const PALE_TINT = 14;
const INK = 35;

/** 予定の色を混ぜた地 */
export function eventTint(color: string, pale = false): string {
  return `color-mix(in srgb, ${color} ${pale ? PALE_TINT : TINT}%, var(--cell))`;
}

/** 地の上の文字 (予定の色を文字色に寄せて、読める濃さにする) */
export function eventInk(color: string): string {
  return `color-mix(in srgb, ${color} ${INK}%, var(--foreground))`;
}

/** 地 + 文字。時間表のブロックに使う */
export function eventBlockStyle(color: string, pale = false): CSSProperties {
  return {
    backgroundColor: eventTint(color, pale),
    color: eventInk(color),
  };
}
