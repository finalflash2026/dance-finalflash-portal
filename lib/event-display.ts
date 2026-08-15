/**
 * マイカレンダーの予定をどう見せるか (SPEC.md §6.4 / §12)
 *
 * ラベルカレンダーのマスと日別タイムラインのブロックで、**同じ予定が同じ色・
 * 同じ短縮名**になるようにここへ集約する。片方だけ変えると
 * 「カレンダーの青いやつ」と「タイムラインの緑のやつ」が同一だと分からなくなる。
 */

import {
  GENRE_COLORS,
  SLOT_CLAIMED_COLOR,
  type GenreCode,
} from "@/lib/constants";
import { numberColor } from "@/lib/numbers";
import type { MyEvent } from "@/lib/types";

/** 予定の表示色。ジャンル練はジャンル色、ナンバー練はナンバー色 */
export function eventColor(event: MyEvent): { bg: string; fg: string } {
  if (event.kind === "number" && event.numberId) {
    return numberColor(event.numberId);
  }
  if (event.kind === "genre" && event.genreCode) {
    const color = GENRE_COLORS[event.genreCode as GenreCode];
    if (color) return color;
  }
  // 空き申請と、ジャンルが引けなかった公式練
  return SLOT_CLAIMED_COLOR;
}

/**
 * ミニカレンダーのマスに入れる短い表示 (SPEC §6.4-4)。
 *
 * ナンバー名は**切り詰めない**。1マスが 55px 程度しかないので溢れるが、
 * 実際の省略は CSS の truncate に任せる。JS で固定文字数に切ると、
 * 画面が広くて入る場合でも短いままになってしまうため。
 */
export function eventShortLabel(event: MyEvent): string {
  if (event.kind === "genre") return event.genreCode ?? "公式練";
  if (event.kind === "claim") return "空き";
  return event.title;
}

/** 絞り込みチップのキー (SPEC §6.4-3)。公式練と自分の申請は同じ束に入れる */
export function eventFilterKey(event: MyEvent): string {
  return event.kind === "number" && event.numberId
    ? `number:${event.numberId}`
    : "official";
}
