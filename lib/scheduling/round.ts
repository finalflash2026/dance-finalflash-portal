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

/**
 * デモ環境 (Supabase につないだデモ。§6.8.4 / v1.35) の回。**再来月**を受付中にし、
 * 締切は来月の15日。回答の保存 (DB) を作るまでの仮の回
 */
export function liveDemoRound(today: DateString = todayInTokyo()): ScheduleRound {
  const thisMonth = startOfMonth(today);
  return {
    id: "round-live-demo",
    month: addMonths(thisMonth, 2),
    deadline: addDays(addMonths(thisMonth, 1), 14),
    status: "open",
    answeredCount: 0,
    memberCount: 0,
    answeredByMe: false,
  };
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
