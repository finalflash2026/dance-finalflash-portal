/**
 * 日程調整のデモ用の見本 (SPEC.md §6.8.4)。**実在の登録者の名前は使わない。**
 *
 * 来月の予約枠 (画像のコマ割り表と同じ形: 7号館・講堂は平日 90分×2、
 * フレスコは平日 70分×3・土日 90分×5) と、150人ぶんの回答を作る。
 * 種を決めた乱数で作るので、いつ開いても同じ見本になる。
 */
import { GENRES, ROOMS } from "@/lib/constants";
import { addDays, addMonths, getWeekday, startOfMonth, todayInTokyo } from "@/lib/time";

import { answerKey, bandOf } from "./plan";
import type { Answer, AnswerKey, Candidate, Member, PlanInput } from "./types";

/** 決まった種から 0〜1 を返す乱数 (mulberry32) */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEKDAY_90 = [
  ["18:00", "19:30"],
  ["19:40", "21:10"],
] as const;
const WEEKDAY_70 = [
  ["18:00", "19:10"],
  ["19:15", "20:25"],
  ["20:30", "21:40"],
] as const;
const WEEKEND_90 = [
  ["13:00", "14:30"],
  ["14:40", "16:10"],
  ["16:20", "17:50"],
  ["18:00", "19:30"],
  ["19:40", "21:10"],
] as const;

const NAMES = ["たろう", "はなこ", "じろう", "さくら", "けんた", "みお", "ゆうき", "あおい", "りく", "ひなた", "そら", "めい", "かいと", "ゆい", "はると"];

/** 来月の月初 */
export function demoMonth(): string {
  return addMonths(startOfMonth(todayInTokyo()), 1);
}

export function demoCandidates(month = demoMonth()): Candidate[] {
  const rand = random(20261101);
  const roomById = new Map(ROOMS.map((r) => [r.id, r]));
  const candidates: Candidate[] = [];
  const push = (date: string, roomId: number, times: readonly (readonly [string, string])[]) => {
    const room = roomById.get(roomId)!;
    for (const [startTime, endTime] of times) {
      candidates.push({
        id: `${date}-${roomId}-${startTime}`,
        date,
        section: room.section,
        roomId,
        startTime,
        endTime,
      });
    }
  };
  for (let date = month; date < addMonths(month, 1); date = addDays(date, 1)) {
    const wd = getWeekday(date);
    if (wd === 0 || wd === 6) {
      // 土日はフレスコだけ。取れる部屋は日による
      for (const roomId of [2, 3, 4]) if (rand() < 0.75) push(date, roomId, WEEKEND_90);
      continue;
    }
    if (rand() < 0.15) continue; // 予約が取れなかった日
    if (rand() < 0.5) push(date, 1, WEEKDAY_90); // 7号館 スタジオ101
    for (const roomId of [2, 3]) if (rand() < 0.4) push(date, roomId, WEEKDAY_70);
    if (rand() < 0.6) push(date, 5, WEEKDAY_90); // 講堂 リハーサル室
  }
  return candidates;
}

export function demoMembers(): Member[] {
  const rand = random(150);
  const members: Member[] = [];
  for (let i = 0; i < 150; i++) {
    const main = GENRES[Math.floor(rand() * GENRES.length)].id;
    const genres = [main];
    if (rand() < 0.45) {
      const sub = GENRES[Math.floor(rand() * GENRES.length)].id;
      if (!genres.includes(sub)) genres.push(sub);
    }
    if (genres.length === 2 && rand() < 0.3) {
      const sub = GENRES[Math.floor(rand() * GENRES.length)].id;
      if (!genres.includes(sub)) genres.push(sub);
    }
    const generation = 21 + Math.floor(rand() * 4);
    const code = GENRES.find((g) => g.id === main)!.code;
    members.push({ id: `m${i}`, name: `${generation}${code}${NAMES[i % NAMES.length]}`, genres });
  }
  return members;
}

/**
 * 回答の見本。人ごとに「忙しい曜日」「夜が苦手」などの傾向を持たせ、
 * ジャンルごとにも傾向を付ける (人が集まりやすい日に差が出るように)。
 * 1割は未回答
 */
export function demoAnswers(members: Member[], candidates: Candidate[]): PlanInput["answers"] {
  const rand = random(7);
  const keys = [
    ...new Set(candidates.map((c) => answerKey(c.date, bandOf(c.startTime)))),
  ] as AnswerKey[];
  const answers: PlanInput["answers"] = {};
  for (const member of members) {
    if (rand() < 0.1) continue;
    const busyDays = new Set([Math.floor(rand() * 5) + 1, Math.floor(rand() * 5) + 1]);
    const nightOwl = rand();
    // ジャンルごとの傾向: 偶数のジャンルは週末に集まりやすい
    const weekendFan = member.genres[0] % 2 === 0 ? 0.25 : -0.1;
    const mine: Partial<Record<AnswerKey, Answer>> = {};
    for (const key of keys) {
      const [date, band] = key.split("|");
      const wd = getWeekday(date);
      let p = 0.62;
      if (busyDays.has(wd)) p -= 0.45;
      if (band === "night") p += (nightOwl - 0.5) * 0.4;
      if (wd === 0 || wd === 6) p += weekendFan;
      const r = rand();
      mine[key] = r < p ? "ok" : r < p + 0.15 ? "maybe" : "no";
    }
    answers[member.id] = mine;
  }
  return answers;
}

export function demoInput(): PlanInput {
  const candidates = demoCandidates();
  const members = demoMembers();
  return {
    genres: GENRES.map((g) => ({ id: g.id, code: g.code })),
    candidates,
    members,
    answers: demoAnswers(members, candidates),
  };
}
