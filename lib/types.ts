/**
 * DB 行の TypeScript 型 (SPEC.md §5.2 のスキーマに対応)
 *
 * 日付は 'YYYY-MM-DD'、時刻は 'HH:MM' / 'HH:MM:SS' の文字列で扱う。
 * DB 側が date / time 型なので Date に変換せず文字列のまま流すことで、
 * UTC 変換による日付ズレを構造的に防ぐ (SPEC §2: 全機能 Asia/Tokyo 固定)。
 */

/** 'YYYY-MM-DD' */
export type DateString = string;
/** 'HH:MM'。DB から返る 'HH:MM:SS' は lib/time.ts の normalizeTime で丸める */
export type TimeString = string;

export type Role = "ob" | "member" | "coordinator" | "admin";
export type SlotStatus = "genre" | "open" | "unavailable";
export type ReservationStatus = "active" | "cancelled";
export type ImportFileStatus = "pending" | "confirmed";
export type AttendanceStatus = "absent" | "late" | "leave_early";
export type NotificationType =
  | "number_added"
  | "schedule_updated"
  | "attendance_updated";

// ---------- マスタ ----------

export interface Genre {
  id: number;
  code: string;
  sort_order: number;
}

export interface Room {
  id: number;
  name: string;
  section: string;
  sort_order: number;
}

export interface RoomAlias {
  alias: string;
  room_id: number;
}

// ---------- ユーザー ----------

export interface Profile {
  user_id: string;
  username: string;
  generation: number;
  main_genre_id: number;
  display_name: string;
  role: Role;
  created_at: string;
}

export interface UserSubgenre {
  user_id: string;
  /** 2ジャン=2 / 3ジャン=3 */
  slot: 2 | 3;
  genre_id: number;
}

// ---------- 第1層: 予約枠 ----------

export interface ImportFile {
  id: string;
  filename: string;
  row_count: number;
  uploaded_by: string;
  status: ImportFileStatus;
  created_at: string;
}

export interface Reservation {
  id: string;
  import_file_id: string | null;
  date: DateString;
  start_time: TimeString;
  end_time: TimeString;
  room_id: number;
  status: ReservationStatus;
  note: string | null;
  created_by: string;
  created_at: string;
}

// ---------- 第2層: コマ ----------

export interface Slot {
  id: string;
  reservation_id: string;
  date: DateString;
  start_time: TimeString;
  end_time: TimeString;
  room_id: number;
  status: SlotStatus;
  /** status='genre' のとき必須 */
  genre_id: number | null;
  /** null = 全期対象 */
  target_generations: number[] | null;
  published: boolean;
  note: string | null;
  updated_at: string;
}

// ---------- 第3層: 空き申請 ----------

export interface Claim {
  id: string;
  slot_id: string;
  user_id: string;
  start_time: TimeString;
  end_time: TimeString;
  purpose: string | null;
  created_at: string;
}

// ---------- 第3層: ナンバー ----------

/** DB の numbers テーブル。グローバルの Number と衝突するため DanceNumber とする */
export interface DanceNumber {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface NumberMember {
  number_id: string;
  user_id: string;
  added_at: string;
}

export interface NumberEvent {
  id: string;
  number_id: string;
  date: DateString;
  start_time: TimeString;
  end_time: TimeString;
  /** 自由記入 (レンタルスタジオ名等) */
  place: string;
  note: string | null;
  created_at: string;
}

// ---------- その他 ----------

export interface CalendarToken {
  user_id: string;
  token: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
}

export interface Attendance {
  id: string;
  user_id: string;
  /** 公式練の出欠。number_event_id とは排他 */
  slot_id: string | null;
  /** ナンバー練の出欠。slot_id とは排他 */
  number_event_id: string | null;
  status: AttendanceStatus;
  /** late=到着予定時刻 / leave_early=退出予定時刻 */
  time_value: TimeString | null;
  updated_at: string;
}

export interface RoomStatus {
  date: DateString;
  room_id: number;
  /** true=開錠済(○) / false=施錠中(×)。行が無ければ × 扱い */
  is_unlocked: boolean;
  updated_by: string;
  updated_at: string;
}

export interface AdminAuditLog {
  id: string;
  actor_id: string;
  target_user_id: string | null;
  action: string;
  detail: unknown;
  created_at: string;
}

export interface AppSetting {
  key: "signup_pass" | "coordinator_pass" | "admin_pass";
  value_hash: string;
  updated_at: string;
}

// ---------- 画面共通 ----------

/** マイカレンダー / ics で共通に扱うイベント (SPEC §6.4 / §10) */
export interface MyEvent {
  kind: "genre" | "claim" | "number";
  /** ics の UID に使う恒久 ID (元テーブルの主キー) */
  sourceId: string;
  date: DateString;
  startTime: TimeString;
  endTime: TimeString;
  title: string;
  location: string;
  /**
   * kind='number' のときの所属ナンバー。タブ③の絞り込みチップと
   * 色の割り当てに使う (SPEC §6.4-3)。それ以外は null。
   */
  numberId: string | null;
  /**
   * kind='genre' のときのジャンルコード。ラベルカレンダーのマスに出す短い
   * 表示 (§6.4-4) と色の割り当てに使う。それ以外は null。
   */
  genreCode: string | null;
}
