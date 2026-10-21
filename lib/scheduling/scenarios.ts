/**
 * 条件の学習 (SPEC §6.8.6) とデモに使う見本の月。**実在の登録者の名前は使わない。**
 *
 * 過去のコマ割り表 (2026年5〜11月) の形を元にする:
 *   - 平日夕方: 7号館 スタジオ101 と 講堂 (リハーサル室・控室) は 90分×2、
 *               フレスコ (練習室1・2・展示) は 70分×3
 *   - 土日:     フレスコで 90分×5 (13:00〜21:10)
 *   - 長期休み: 110分×4 (13:00〜21:10)。アリーナ・剣道場も取れる日がある
 *   - 取れる部屋は日によってまちまち (取れない日・取れない部屋がある)
 * 部員は150人。ジャンルの人数に差を付ける (多い 28人〜少ない 8人)。
 */
import { GENRES } from "@/lib/constants";
import { addDays, addMonths, getWeekday } from "@/lib/time";

import { keyOf } from "./plan";
import type { Answer, AnswerKey, Candidate, Member, PlanInput } from "./types";

/** 決まった種から 0〜1 を返す乱数 (mulberry32) */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Times = readonly (readonly [string, string])[];
const EVENING_90: Times = [["18:00", "19:30"], ["19:40", "21:10"]];
const EVENING_70: Times = [["18:00", "19:10"], ["19:15", "20:25"], ["20:30", "21:40"]];
const WEEKEND_90: Times = [["13:00", "14:30"], ["14:40", "16:10"], ["16:20", "17:50"], ["18:00", "19:30"], ["19:40", "21:10"]];
const HOLIDAY_110: Times = [["13:00", "14:50"], ["15:00", "16:50"], ["17:00", "19:00"], ["19:10", "21:10"]];

const SECTION: Record<number, string> = {
  1: "7号館", 2: "フレスコ", 3: "フレスコ", 4: "フレスコ", 5: "講堂", 6: "講堂", 7: "講堂", 8: "講堂",
  9: "アリーナ", 10: "アリーナ", 11: "アリーナ", 12: "アリーナ",
};

/** ジャンルの人数 (合計150人)。GENRES の並びに対応する */
const GENRE_SIZES: Record<string, number> = {
  HIPHOP: 28, BREAK: 22, POP: 20, JAZZ: 18, LOCK: 16, HOUSE: 14, GIRLS: 12, PUNKING: 12, KRUMP: 8,
};

export function genreSize(code: string): number {
  return GENRE_SIZES[code] ?? 10;
}

/** 予約の取れ方 (見本の月ごとに選ぶ) */
export type MonthKind = "term" | "holiday";

export function scenarioCandidates(month: string, kind: MonthKind, seed: number): Candidate[] {
  const rand = random(seed);
  const out: Candidate[] = [];
  const push = (date: string, roomId: number, times: Times) => {
    for (const [startTime, endTime] of times) {
      out.push({ id: `${date}-${roomId}-${startTime}`, date, section: SECTION[roomId], roomId, startTime, endTime });
    }
  };
  for (let date = month; date < addMonths(month, 1); date = addDays(date, 1)) {
    const wd = getWeekday(date);
    if (kind === "holiday") {
      if (wd === 0 || rand() < 0.45) continue; // 長期休みは週2〜3日
      if (rand() < 0.5) push(date, 1, HOLIDAY_110);
      for (const roomId of [3, 4]) if (rand() < 0.5) push(date, roomId, HOLIDAY_110);
      if (rand() < 0.6) push(date, 5, HOLIDAY_110);
      if (rand() < 0.35) push(date, 10, HOLIDAY_110);
      if (rand() < 0.3) push(date, 12, HOLIDAY_110);
      continue;
    }
    if (wd === 0 || wd === 6) {
      if (rand() < 0.5) continue;
      for (const roomId of [2, 3, 4]) if (rand() < 0.45) push(date, roomId, WEEKEND_90);
      continue;
    }
    if (wd === 2 || wd === 5 || rand() < 0.15) continue; // 火・金は取らない (過去の表と同じ)
    if (rand() < 0.5) push(date, 1, EVENING_90);
    for (const roomId of [2, 3, 4]) if (rand() < 0.35) push(date, roomId, EVENING_70);
    if (rand() < 0.55) push(date, 5, EVENING_90);
    if (rand() < 0.15) push(date, 8, EVENING_90);
  }
  return out;
}

export function scenarioMembers(seed: number): Member[] {
  const rand = random(seed);
  const members: Member[] = [];
  for (const genre of GENRES) {
    for (let i = 0; i < genreSize(genre.code); i++) {
      const genres = [genre.id];
      if (rand() < 0.4) {
        const sub = GENRES[Math.floor(rand() * GENRES.length)].id;
        if (!genres.includes(sub)) genres.push(sub);
      }
      members.push({ id: `${genre.code}-${i}`, name: `${21 + (i % 4)}${genre.code}${i + 1}`, genres });
    }
  }
  return members;
}

/**
 * 回答。人ごとに「忙しい曜日」「夜が苦手」などの傾向を持たせる。
 * ごく一部の人は空いている日が少ない (偏りが出やすい人)。1割は未回答
 */
export function scenarioAnswers(members: Member[], candidates: Candidate[], seed: number): PlanInput["answers"] {
  const rand = random(seed);
  const keys = [...new Set(candidates.map(keyOf))] as AnswerKey[];
  const answers: PlanInput["answers"] = {};
  for (const member of members) {
    if (rand() < 0.1) continue;
    const busy = new Set([Math.floor(rand() * 7), Math.floor(rand() * 7)]);
    const night = rand() - 0.5;
    const base = rand() < 0.15 ? 0.3 : 0.65; // 15% は空いている日が少ない人
    const mine: Partial<Record<AnswerKey, Answer>> = {};
    for (const key of keys) {
      const [date, range] = key.split("|");
      let p = base;
      if (busy.has(getWeekday(date))) p -= 0.5;
      if (range >= "19") p += night * 0.4;
      const r = rand();
      mine[key] = r < p ? "ok" : r < p + 0.12 ? "maybe" : "no";
    }
    answers[member.id] = mine;
  }
  return answers;
}

export function scenario(month: string, kind: MonthKind, seed: number): PlanInput {
  const candidates = scenarioCandidates(month, kind, seed);
  const members = scenarioMembers(seed + 1);
  return {
    genres: GENRES.map((g) => ({ id: g.id, code: g.code })),
    candidates,
    members,
    answers: scenarioAnswers(members, candidates, seed + 2),
  };
}

/** 学習に使う見本の月 (学期中 4か月 + 長期休み 2か月) */
export const TRAINING_SCENARIOS: { name: string; month: string; kind: MonthKind; seed: number }[] = [
  { name: "学期A", month: "2026-05-01", kind: "term", seed: 501 },
  { name: "学期B", month: "2026-06-01", kind: "term", seed: 601 },
  { name: "学期C", month: "2026-10-01", kind: "term", seed: 1001 },
  { name: "学期D", month: "2026-11-01", kind: "term", seed: 1101 },
  { name: "休みA", month: "2026-08-01", kind: "holiday", seed: 801 },
  { name: "休みB", month: "2026-09-01", kind: "holiday", seed: 901 },
];
