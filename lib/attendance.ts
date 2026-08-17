/**
 * 出欠管理 (SPEC.md §6.4.2)
 *
 * 「行が無い人 = 出席」が大前提。既定行を作らないので、参加者名簿と
 * `attendances` を突き合わせて初めて一覧が作れる。
 *
 * **認可は RLS が持っている** (`mod_att` が「自分の出欠のみ・かつ参加者のみ」を
 * DB で強制し、`sel_att` がナンバー練の出欠を非メンバーから隠す)。
 * ここにあるのは表示のための組み立てだけで、権限判定は置かないこと。
 */

import { stepOptions } from "@/lib/claims";
import type { AttendanceStatus, TimeString } from "@/lib/types";

/** 遅刻・早退の時刻は15分刻み (SPEC §6.4.2) */
export const ATTENDANCE_STEP_MINUTES = 15;

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  absent: "欠席",
  late: "遅刻",
  leave_early: "早退",
};

/** 時刻の意味が状態で変わるので、入力欄の見出しもここで決める */
export const ATTENDANCE_TIME_LABELS: Record<AttendanceStatus, string> = {
  absent: "",
  late: "到着予定",
  leave_early: "退出予定",
};

export interface AttendanceRow {
  userId: string;
  status: AttendanceStatus;
  /** late=到着予定時刻 / leave_early=退出予定時刻 */
  timeValue: TimeString | null;
}

export interface Participant {
  userId: string;
  username: string;
  /** 行が無ければ null = 出席 */
  attendance: AttendanceRow | null;
}

/** 一覧に出す表示。「欠席」「遅刻 15:00」「早退 15:00」/ 行が無ければ「出席」 */
export function formatAttendance(row: AttendanceRow | null): string {
  if (!row) return "出席";
  const label = ATTENDANCE_LABELS[row.status];
  return row.timeValue ? `${label} ${row.timeValue}` : label;
}

/**
 * 参加者名簿と出欠行を突き合わせる。
 * 未登録(=出席)を先に、登録済みを後ろにまとめると、
 * 「誰が来られないのか」を上から探さずに済む。
 */
export function buildParticipants(
  people: { userId: string; username: string }[],
  attendances: AttendanceRow[],
): Participant[] {
  const byUser = new Map(attendances.map((row) => [row.userId, row]));
  return people
    .map((person) => ({
      userId: person.userId,
      username: person.username,
      attendance: byUser.get(person.userId) ?? null,
    }))
    .sort((a, b) => {
      const rank = (p: Participant) => (p.attendance ? 0 : 1);
      return rank(a) - rank(b) || a.username.localeCompare(b.username, "ja");
    });
}

/**
 * 遅刻・早退の時刻候補 (SPEC §6.4.2「15分刻みプルダウン+直接入力可」)。
 * 練習の時間帯の中だけを出す。範囲外の時刻は入力欄に直接書けばよく、
 * 候補に並べても選ぶ手間が増えるだけのため。
 */
export function attendanceTimeOptions(
  startTime: TimeString,
  endTime: TimeString,
): TimeString[] {
  return stepOptions({ startTime, endTime }, ATTENDANCE_STEP_MINUTES);
}
