/**
 * 日程調整の回 (SPEC.md §6.8.1)。ホームのカード・近い締切・お知らせに出す要約。
 *
 * いまはデモだけ (DB を作る次の段階で availability_rounds から読む)。
 */
import { addDays, addMonths, parseDate, startOfMonth, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

export interface ScheduleRound {
  id: string;
  /** 対象の月の月初 */
  month: DateString;
  /** 締切の日 (その日の 23:59 まで) */
  deadline: DateString;
  status: "open" | "closed";
  answeredCount: number;
  memberCount: number;
  /** 見ている人が回答したか */
  answeredByMe: boolean;
}

export function roundTitle(round: ScheduleRound): string {
  return `${parseDate(round.month).month}月の日程調整`;
}

/** デモの回。来月ぶんを受付中、締切は1週間後 */
export function demoRound(): ScheduleRound {
  const today = todayInTokyo();
  return {
    id: "round-demo",
    month: addMonths(startOfMonth(today), 1),
    deadline: addDays(today, 7),
    status: "open",
    answeredCount: 130,
    memberCount: 150,
    answeredByMe: false,
  };
}
