/**
 * 縦タイムライン (行=時間軸のみ・列なし) のレイアウト計算 (SPEC.md §6.3 / §6.4)
 *
 * タブ②のナンバーカレンダーとタブ③のマイカレンダーが共用する。
 * タブ①の DayGrid は「列=部屋」が決まっているので別物で、
 * こちらは**重なった予定を横に並べて逃がす**必要がある
 * (同じ時間に公式練とナンバー練が入ることは普通にある)。
 */

import { DAY_END_TIME, DAY_START_TIME, toMinutes } from "@/lib/time";

export interface TimeSpan {
  startTime: string;
  endTime: string;
}

/** レーン割り当て済みの1件。lane は 0 始まり、lanes はそのグループの列数 */
export interface Packed<T> {
  item: T;
  lane: number;
  lanes: number;
}

/**
 * 重なる予定を横に並べる (Appleカレンダー様式)。
 *
 * 「重なりの塊 (cluster)」ごとに列数を決めるのが要点。全体の最大列数で
 * 割ってしまうと、1件しか無い時間帯まで細く描かれて読めなくなる。
 *
 * 例: 10-11 と 10:30-12 が重なり、15-16 が単独なら
 *     前者2件は半分幅・後者は全幅になる。
 */
export function packLanes<T extends TimeSpan>(items: T[]): Packed<T>[] {
  const sorted = [...items].sort(
    (a, b) =>
      toMinutes(a.startTime) - toMinutes(b.startTime) ||
      toMinutes(a.endTime) - toMinutes(b.endTime),
  );

  const result: Packed<T>[] = [];
  let cluster: Packed<T>[] = [];
  /** cluster 内の各レーンの終了時刻 */
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length;
    for (const packed of cluster) result.push({ ...packed, lanes });
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const start = toMinutes(item.startTime);
    const end = toMinutes(item.endTime);

    // どのレーンとも重ならなくなったら、そこで塊が切れる
    if (laneEnds.length > 0 && laneEnds.every((laneEnd) => laneEnd <= start)) {
      flush();
    }

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    cluster.push({ item, lane, lanes: 0 });
  }
  flush();

  return result;
}

/**
 * 時間軸の範囲。既定は 09:00〜22:00 (SPEC §6.1) だが、
 * はみ出す予定があれば時間単位で広げる。
 * ナンバー練はレンタルスタジオで夜遅くまで、ということがあるため、
 * 端で切ると予定が見えなくなる。
 */
export function timelineAxis(items: TimeSpan[]): {
  start: number;
  end: number;
} {
  const starts = items.map((i) => Math.floor(toMinutes(i.startTime) / 60) * 60);
  const ends = items.map((i) => Math.ceil(toMinutes(i.endTime) / 60) * 60);
  return {
    start: Math.min(toMinutes(DAY_START_TIME), ...starts),
    end: Math.max(toMinutes(DAY_END_TIME), ...ends),
  };
}
