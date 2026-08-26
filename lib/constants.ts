/**
 * マスタデータと表示定数 (SPEC.md §4 / §12)
 *
 * genres / rooms は DB のシード (§5.2) と id まで一致させること。
 * 表示順・色の一元管理のためにフロントでも定数として保持する。
 */

import type { Role } from "@/lib/types";

// ---------- ジャンル (SPEC §4.1) ----------

export const GENRES = [
  { id: 1, code: "BREAK", sortOrder: 1 },
  { id: 2, code: "HIPHOP", sortOrder: 2 },
  { id: 3, code: "POP", sortOrder: 3 },
  { id: 4, code: "LOCK", sortOrder: 4 },
  { id: 5, code: "JAZZ", sortOrder: 5 },
  { id: 6, code: "HOUSE", sortOrder: 6 },
  { id: 7, code: "PUNKING", sortOrder: 7 },
  { id: 8, code: "KRUMP", sortOrder: 8 },
  { id: 9, code: "GIRLS", sortOrder: 9 },
] as const;

export type GenreCode = (typeof GENRES)[number]["code"];

export interface GenreDef {
  id: number;
  code: GenreCode;
  sortOrder: number;
}

/** id は DB から来る任意の number を受けたいので、キーを number に広げておく */
export const GENRE_BY_ID: ReadonlyMap<number, GenreDef> = new Map(
  GENRES.map((g) => [g.id as number, g as GenreDef]),
);

/**
 * ジャンル色 (SPEC §12: 9色を定数で一元管理・コントラスト確保・文字は黒/白自動)。
 * fg は bg に対して WCAG AA (4.5:1) 以上になるよう選んである。
 */
export const GENRE_COLORS: Record<GenreCode, { bg: string; fg: string }> = {
  BREAK: { bg: "#C0392B", fg: "#FFFFFF" },
  HIPHOP: { bg: "#2F6FB5", fg: "#FFFFFF" },
  POP: { bg: "#F2C14E", fg: "#1F2933" },
  LOCK: { bg: "#6B3FA0", fg: "#FFFFFF" },
  JAZZ: { bg: "#2E8B57", fg: "#FFFFFF" },
  HOUSE: { bg: "#0E7C86", fg: "#FFFFFF" },
  PUNKING: { bg: "#B0246B", fg: "#FFFFFF" },
  KRUMP: { bg: "#3F4A5A", fg: "#FFFFFF" },
  GIRLS: { bg: "#F3B0D3", fg: "#1F2933" },
};

/**
 * ナンバーのブロック色 (SPEC §6.3「ナンバーごとに色を自動割当」)。
 *
 * ジャンル色と取り違えないよう、GENRE_COLORS とは別の色域から選んである。
 * どれも白文字が乗る明度にしてあるので fg は白で固定。
 * 隣り合う要素が似た色にならないよう、色相が近いものを離して並べている。
 * 割り当ては lib/numbers.ts の numberColor() が id から決定的に行う
 * (同じナンバーは端末や画面をまたいでも常に同じ色になること)。
 */
export const NUMBER_COLORS = [
  "#3B5BDB",
  "#C2410C",
  "#0F766E",
  "#9D174D",
  "#92400E",
  "#4F46E5",
  "#15803D",
  "#7E22CE",
] as const;

/**
 * status='open'(空き) / 'unavailable'(使用不可) のブロック色。
 *
 * **ジャンル色と違い、これは「地」に近い色なのでテーマで変える** (v1.13)。
 * 白に近いまま暗い背景に置くと、空きコマの列が光る板の壁になってしまう。
 * 値は CSS 変数への参照で、実体は app/globals.css にある
 * (インラインスタイルに入れても var() はそのまま効く)。
 */
export const SLOT_OPEN_COLOR = {
  bg: "var(--slot-open-bg)",
  fg: "var(--slot-open-fg)",
};
export const SLOT_UNAVAILABLE_COLOR = {
  bg: "var(--slot-unavailable-bg)",
  fg: "var(--slot-unavailable-fg)",
};
/** 空きコマのうち申請済みの時間帯 (SPEC §6.1)。ジャンル色と混同しない中間色にする */
export const SLOT_CLAIMED_COLOR = {
  bg: "var(--slot-claimed-bg)",
  fg: "var(--slot-claimed-fg)",
};

// ---------- 部屋 (SPEC §4.2) ----------

/**
 * 練習場所 (SPEC §4.2)
 *
 * **正はDBの `rooms` テーブル**(v1.20)。折衝係が取込画面から足せるように
 * したため、コードの固定リストでは追いつかない。画面では `lib/rooms.tsx` の
 * `useRooms()` を使うこと。
 *
 * ここに残してあるのは**Supabase 未設定でも画面が出るようにするための
 * 控え**で、0001 の初期データと同じ12件。増えたぶんは入っていない。
 */
export interface Room {
  id: number;
  name: string;
  /** 所在。列の見出しに使う。固定の一覧は持たない (v1.20) */
  section: string;
  sortOrder: number;
}

export const ROOMS: ReadonlyArray<Room> = [
  { id: 1, name: "スタジオ101(7号館)", section: "7号館", sortOrder: 1 },
  { id: 2, name: "練習室1(フレスコ)", section: "フレスコ", sortOrder: 2 },
  { id: 3, name: "練習室2(フレスコ)", section: "フレスコ", sortOrder: 3 },
  { id: 4, name: "展示・多目的室(フレスコ)", section: "フレスコ", sortOrder: 4 },
  { id: 5, name: "リハーサル室", section: "講堂", sortOrder: 5 },
  { id: 6, name: "控室136", section: "講堂", sortOrder: 6 },
  { id: 7, name: "控室132", section: "講堂", sortOrder: 7 },
  { id: 8, name: "控室131", section: "講堂", sortOrder: 8 },
  { id: 9, name: "アリーナA", section: "アリーナ", sortOrder: 9 },
  { id: 10, name: "アリーナB", section: "アリーナ", sortOrder: 10 },
  { id: 11, name: "アリーナC", section: "アリーナ", sortOrder: 11 },
  { id: 12, name: "剣道場(体育館)", section: "アリーナ", sortOrder: 12 },
];

/** 控えの id 引き。画面では useRoomById() を使うこと (v1.20) */
export const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]));

/**
 * 括弧書きの所在を落とした短い部屋名 (例: 「練習室1(フレスコ)」→「練習室1」)。
 * 取込確認のタイムラインのように、行ラベルの幅が限られる場所で使う。
 * section を別に見出しとして出している場面では所在は冗長になるため。
 */
export function shortRoomName(name: string): string {
  return name.replace(/\([^)]*\)$/, "");
}

/** 取込確認タイムラインの予約枠ブロック色 (SPEC §6.2 Step1-3)。コマの色とは別物 */
export const RESERVATION_BLOCK_COLOR = {
  bg: "var(--reservation-bg)",
  fg: "var(--reservation-fg)",
};

// ---------- 練習曜日 (SPEC §6.2 Step2-1 / v1.9.1) ----------

/**
 * 公式練が入る曜日 (0=日 … 6=土)。月・水・木。
 *
 * コマ割りエディタの既定の絞り込みにだけ使う**表示上の都合**であり、
 * 他の曜日にコマを作ることを禁止するものではない。
 * 金土日の予約枠にも「空き」コマを置いて個人練に開放したい場合があるため、
 * 画面側で全曜日に切り替えられるようにしておくこと。
 */
export const PRACTICE_WEEKDAYS: readonly number[] = [1, 3, 4];

// ---------- ロール (SPEC §3.1) ----------

/**
 * 画面に出すロールの呼び名 (SPEC.md §3.1 / v1.18.1)
 *
 * `admin` は **「3役(管理者)」**。サークル内では「3役」と呼ばれていて、
 * 「管理者」だけだと自分のことだと気づかれなかった。
 */
export const ROLE_LABELS: Record<Role, string> = {
  ob: "OB/OG",
  member: "メンバー",
  coordinator: "折衝",
  admin: "3役(管理者)",
};

/** 折衝以上か (admin ⊃ coordinator ⊃ member の包含判定) */
export function isCoordinatorOrAbove(role: Role): boolean {
  return role === "coordinator" || role === "admin";
}

/** 現役か。OB は member の包含関係の外にある (SPEC §3.1) */
export function isActiveMember(role: Role): boolean {
  return role !== "ob";
}

// ---------- 入力バリデーション ----------

/** マイパスワードの最小長 (SPEC §3.2) */
export const MIN_PASSWORD_LENGTH = 8;
