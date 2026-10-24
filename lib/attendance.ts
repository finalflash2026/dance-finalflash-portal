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

import type { AttendanceStatus, TimeString } from "@/lib/types";

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "出席",
  absent: "欠席",
  late: "遅刻",
  leave_early: "早退",
};

/** 時刻の意味が状態で変わるので、入力欄の見出しもここで決める */
export const ATTENDANCE_TIME_LABELS: Record<AttendanceStatus, string> = {
  present: "",
  absent: "",
  late: "到着予定",
  leave_early: "退出予定",
};

export interface AttendanceRow {
  userId: string;
  status: AttendanceStatus;
  /** late=到着予定時刻 / leave_early=退出予定時刻 */
  timeValue: TimeString | null;
  /** 理由 (v1.33)。書かなくてもよい */
  reason?: string | null;
}

/**
 * 押すだけで入る理由 (SPEC §6.4.2 / v1.33)。毎回打つのは面倒で、
 * 結局書かれなくなるので、よくあるものを並べておく
 */
export const ATTENDANCE_REASON_PRESETS = ["授業", "バイト", "体調不良", "就活", "用事"] as const;

/** 理由の長さの上限。DB の CHECK (0022) と同じ */
export const ATTENDANCE_REASON_MAX = 40;

export interface Participant {
  userId: string;
  username: string;
  /** 行が無ければ null = 未回答 (v1.36。それまでは出席扱い) */
  attendance: AttendanceRow | null;
}

/** 一覧に出す表示。「出席」「欠席」「遅刻 15:00」「早退 15:00」/ 行が無ければ「未回答」 */
export function formatAttendance(row: AttendanceRow | null): string {
  if (!row) return "未回答";
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
      // 来られない人 → 未回答 → 出席 の順。誰が来られないかを上から探さずに済む
      const rank = (p: Participant) =>
        !p.attendance ? 1 : p.attendance.status === "present" ? 2 : 0;
      return rank(a) - rank(b) || a.username.localeCompare(b.username, "ja");
    });
}

/**
 * 遅刻・早退の時刻として妥当か (SPEC §6.4.2 / v1.11)。
 *
 * **1分刻みの自由入力**。v1.11 で15分刻みのプルダウンを廃止した —
 * 実際の到着・退出時刻は15分刻みに乗らないため。
 * 練習の時間帯の外を弾いたりもしない (「開始前に帰る」はありえないが、
 * 遅刻が翌日にまたがるような入力を無理に禁じても得が無い)。
 */
export function isValidAttendanceTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}
