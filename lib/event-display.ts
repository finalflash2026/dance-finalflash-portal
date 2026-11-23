/**
 * マイカレンダーの予定をどう見せるか (SPEC.md §6.4 / §12)
 *
 * ラベルカレンダーのマスと日別タイムラインのブロックで、**同じ予定が同じ色・
 * 同じ短縮名**になるようにここへ集約する。片方だけ変えると
 * 「カレンダーの青いやつ」と「タイムラインの緑のやつ」が同一だと分からなくなる。
 */

import {
  CIRCLE_EVENT_COLOR,
  DEADLINE_COLOR,
  GENRE_COLORS,
  SLOT_CLAIMED_COLOR,
  type GenreCode,
} from "@/lib/constants";
import { expandByDay, type DayEntry } from "@/lib/day-span";
import { numberColor } from "@/lib/numbers";
import { addDays } from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/** 予定の表示色。ジャンル練はジャンル色、ナンバー練はナンバー色 */
export function eventColor(event: MyEvent): { bg: string; fg: string } {
  if (event.kind === "event") return CIRCLE_EVENT_COLOR;
  if (event.kind === "deadline") return DEADLINE_COLOR;
  if (event.kind === "number" && event.numberId) {
    return numberColor(event.numberId);
  }
  // スタ練は公式練と同じ色 (v1.23)。同じジャンルの練習を色で分けると、
  // 「BREAKの予定」を探すのに2色を覚えることになる
  if ((event.kind === "genre" || event.kind === "studio") && event.genreCode) {
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
  // マスは狭いので、スタ練であることは色ではなく短い印で示す
  if (event.kind === "studio") return `${event.genreCode ?? ""}ス`;
  if (event.kind === "claim") return "空き";
  // 締切は見出しの「締切: 」を印に置き換えて短くする
  if (event.kind === "deadline") return `〆${event.title.replace(/^締切: /, "")}`;
  return event.title;
}

/**
 * 絞り込みチップのキー (SPEC §6.4-3 / v1.10)
 *
 * **ジャンル単位・ナンバー単位まで細かく分ける。** 公式練をひとまとめに
 * していると「今週のBREAKだけ見たい」ができなかったため。
 */
export function eventFilterKey(event: MyEvent): string {
  if (event.kind === "number" && event.numberId) {
    return `number:${event.numberId}`;
  }
  // **スタ練は公式練と同じキー** (v1.23)。BREAK を押したら
  // 「BREAK公式練」と「BREAKスタ練」の両方が出る
  if (event.kind === "genre" || event.kind === "studio") {
    return `genre:${event.genreCode ?? "?"}`;
  }
  if (event.kind === "event") return "event";
  if (event.kind === "deadline") return "deadline";
  return "claim";
}

/**
 * 絞り込みに関係なく常に出す予定 (v1.30)。
 *
 * イベントと締切はサークル全体のもので、「BREAKだけ見たい」ときにも
 * 消えてほしくない。合宿の日に BREAK を選んだら合宿が消える、では困る。
 */
export function isAlwaysShown(event: MyEvent): boolean {
  return event.kind === "event" || event.kind === "deadline";
}

/**
 * 予定を「日ごとの断片」に展開する (v1.30)。
 *
 * 日をまたぐ深夜練は lib/day-span.ts の expandByDay に任せ、
 * **複数日のイベント (合宿など) は最終日まで毎日に置く**。
 * 時刻付きの複数日は、初日=開始〜24:00 / 中日=終日 / 最終日=00:00〜終了。
 */
export function expandMyEvents(events: readonly MyEvent[]): DayEntry<MyEvent>[] {
  return events.flatMap((event): DayEntry<MyEvent>[] => {
    if (!event.lastDate || event.lastDate <= event.date) {
      return expandByDay([event]);
    }
    const entries: DayEntry<MyEvent>[] = [];
    for (let date: DateString = event.date; date <= event.lastDate; date = addDays(date, 1)) {
      const first = date === event.date;
      const last = date === event.lastDate;
      entries.push({
        date,
        startTime: event.allDay || !first ? "00:00" : event.startTime,
        endTime: event.allDay || !last ? "24:00" : event.endTime,
        part: "whole",
        event,
      });
    }
    return entries;
  });
}
