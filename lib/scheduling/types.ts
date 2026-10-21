/**
 * 日程調整からのコマ割り (SPEC.md §6.8) の型。
 *
 * このフォルダは**入力を受け取って案を返すだけ**にする。DB にも画面にも
 * 触れないので、表の形のテストデータで確かめられる。
 */
import type { DateString, TimeString } from "@/lib/types";

/** 割り振りの候補になるコマ (予約枠 × コマの時間)。部屋ごとに1つ */
export interface Candidate {
  id: string;
  date: DateString;
  /** 建物 (所在)。コマ割り表の列のまとまり */
  section: string;
  roomId: number;
  startTime: TimeString;
  endTime: TimeString;
}

/** ○ 出られる / △ できれば避けたい / × 出られない */
export type Answer = "ok" | "maybe" | "no";

export interface Member {
  id: string;
  name: string;
  /** 優先度の高い順 (1ジャン, 2ジャン, 3ジャン)。genre id */
  genres: number[];
}

/** 回答の鍵。`日付|開始-終了` (実際のコマの時間。§6.8.2 / v1.32.1) */
export type AnswerKey = `${string}|${string}-${string}`;

export interface PlanInput {
  genres: { id: number; code: string }[];
  candidates: Candidate[];
  members: Member[];
  /** memberId → 回答。無い鍵は未回答 (計算では × と同じ) */
  answers: Record<string, Partial<Record<AnswerKey, Answer>>>;
}

export interface PlanSettings {
  /** △ の重み (○ = 1) */
  maybeWeight: number;
  /** 1ジャン・2ジャン・3ジャンの重み */
  genreWeights: [number, number, number];
  /** 1ジャンルあたりのコマ数。各ジャンルはこれか、これ +1 */
  perGenre: number;
  /** 同じジャンルの1日あたりの上限 (v1.32.1) */
  maxPerDay: number;
  /** 連続するコマを同じ部屋で続けたときの加点 (何人ぶん)。0 で加点しない (v1.32.3) */
  sameRoomBonus: number;
  /** 部屋ごとの広さの重み (roomId → 0.8 / 1 / 1.2)。無い部屋は 1 (v1.32.3) */
  roomWeights: Record<number, number>;
  /**
   * 欠席の偏りの減点の強さ (v1.32.4)。0 で減点しない。人ごとに「出られる割合 ×
   * fairnessTarget × 1ジャンのコマ数」を下回ったぶん × この値を減点する
   */
  fairnessWeight: number;
  /** 欠席の偏りの目安 (0〜1) */
  fairnessTarget: number;
  /** 広い部屋 (roomWeights が 1 より大きい部屋) を各ジャンルに月これだけは入れる (v1.32.4) */
  minBigPerGenre: number;
  /** この人数 (見込み) に届かないコマに印を付ける。0 なら付けない */
  minPeople: number;
  /** ソルバーの制限時間 (秒) */
  timeLimitSeconds: number;
}

export interface Assignment {
  candidateId: string;
  genreId: number;
  /** 見込み人数 (優先度の高いジャンルへ流れる人を除いた後) */
  ok: number;
  maybe: number;
  /** 同じ時間に優先度の高いジャンルが入ったために来られない人数 */
  lostToOverlap: number;
  belowMin: boolean;
}

export interface PlanResult {
  status: "optimal" | "time-limit" | "infeasible" | "error";
  message?: string;
  assignments: Assignment[];
  /** ジャンルごとのコマ数と見込み人数 (○ + △×重み) の合計 */
  perGenre: { genreId: number; slots: number; expected: number }[];
  /** 実際に使った「1ジャンルあたりのコマ数」。入らなかったときは減らしてある */
  perGenreUsed?: number;
  /** 計算にかかった時間 (ms) */
  elapsedMs: number;
  /** 変数と制約の数 (規模の確認用) */
  size: { variables: number; constraints: number };
}
