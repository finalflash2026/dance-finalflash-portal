/**
 * 予約枠をコマの時間に割って、日程調整の候補にする (SPEC.md §6.8.4 / v1.35)。
 *
 * 予約枠は「18:00〜21:10」のように通しで取ってあるので、過去のコマ割り表と
 * 同じ区切り (7号館・講堂 90分×2、フレスコ 70分×3、土日 90分×5、長期休み 110分×4)
 * のうち、始まりと終わりがぴったり合うものを当てる。合うものが無ければ
 * 予約枠をそのまま1コマにする。
 */
import { EVENING_70, EVENING_90, HOLIDAY_110, WEEKEND_90, type Times } from "./scenarios";
import type { Candidate } from "./types";

const PATTERNS: Times[] = [EVENING_90, EVENING_70, WEEKEND_90, HOLIDAY_110];

export interface ReservationLike {
  date: string;
  startTime: string;
  endTime: string;
  roomId: number;
  section: string;
}

export function candidatesFromReservations(reservations: ReservationLike[]): Candidate[] {
  const out: Candidate[] = [];
  for (const r of reservations) {
    const pattern = PATTERNS.find(
      (p) => p[0][0] === r.startTime && p[p.length - 1][1] === r.endTime,
    );
    const times: Times = pattern ?? [[r.startTime, r.endTime]];
    for (const [startTime, endTime] of times) {
      out.push({
        id: `${r.date}-${r.roomId}-${startTime}`,
        date: r.date,
        section: r.section,
        roomId: r.roomId,
        startTime,
        endTime,
      });
    }
  }
  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}
