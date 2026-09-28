/**
 * 予約枠のつながり (SPEC.md §6.2 Step1 / §9.4 / v1.29.1)
 *
 * 施設の予約ページは、**続きの時間帯を別の行として出すことがある**。
 * 実例: 2026-10-12 の会議室1 が `17:30〜19:30` と `19:30〜21:30` の2行。
 * 借りているのは通しの 17:30〜21:30 なのに、行が分かれて入ってくる。
 *
 * これを2行のまま持つと**コマ割りが破綻する**。コマ (slots) は予約枠の
 * 中に入る前提で作ってあり、`18:50〜20:00` のように境目をまたぐコマは
 * どちらの枠にも収まらない。表でも「予約はあるが覆えていない (△)」になり、
 * 練習を置けなくなる。
 *
 * そこで**つながっている予約枠は1本にまとめる**。取込時にまとめ、
 * 既に分かれて入っているものは②の画面から直せるようにする。
 */

import { toMinutes } from "@/lib/time";

export interface Span {
  startTime: string;
  endTime: string;
}

/**
 * つながっている / 重なっている区間ごとにまとめる。
 *
 * **接しているだけ (前の終わり = 次の始まり) でもまとめる。** そこが
 * 今回の問題の中心で、施設側は続きの枠を別行にして返してくる。
 *
 * 呼ぶ側で「同じ日・同じ部屋」に絞ってから渡すこと。
 * 1件だけのグループも返す (呼ぶ側で2件以上を選ぶ)。
 */
export function groupTouchingSpans<T extends Span>(spans: readonly T[]): T[][] {
  const sorted = [...spans].sort(
    (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
  );

  const groups: T[][] = [];
  let current: T[] = [];
  let reach = -1;

  for (const span of sorted) {
    const start = toMinutes(span.startTime);
    const end = toMinutes(span.endTime);
    if (current.length === 0 || start > reach) {
      if (current.length > 0) groups.push(current);
      current = [span];
      reach = end;
      continue;
    }
    current.push(span);
    reach = Math.max(reach, end);
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

/**
 * 同じ日・同じ部屋で分かれている予約枠を探す (2件以上のグループだけ)。
 * ②の画面で「つなげますか」と出すために使う。
 */
export function findSplitReservations<
  T extends Span & { date: string; roomId: number },
>(reservations: readonly T[]): T[][] {
  const byRoom = new Map<string, T[]>();
  for (const reservation of reservations) {
    const key = `${reservation.date}|${reservation.roomId}`;
    const list = byRoom.get(key);
    if (list) list.push(reservation);
    else byRoom.set(key, [reservation]);
  }

  const groups: T[][] = [];
  for (const list of byRoom.values()) {
    for (const group of groupTouchingSpans(list)) {
      if (group.length >= 2) groups.push(group);
    }
  }

  return groups.sort(
    (a, b) =>
      a[0].date.localeCompare(b[0].date) ||
      a[0].roomId - b[0].roomId ||
      toMinutes(a[0].startTime) - toMinutes(b[0].startTime),
  );
}
