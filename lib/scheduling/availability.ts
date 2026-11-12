/**
 * コマ割りの表に出す「出られる人の数」(SPEC.md §6.2 / v1.47)。
 *
 * 日程調整の回答から、日付 × コマの時間 × ジャンルごとに ○ / △ の人数を数える。
 * ジャンルの人は 1ジャン・2/3ジャンのどれかにそのジャンルがある現役。
 * 回答が1件も無いとき (日程調整をしていない月) は null を返し、表には何も出さない。
 *
 * 表のコマの時間と日程調整の候補の時間は、ずれることがある (コマの時間を月ごとに直せるため)。
 * **その日の候補のうち、表のコマと一番長く重なる時間の回答**を使う。重ならなければ出さない。
 */
import { answerKey } from "./plan";
import type { PlanInput } from "./types";

export interface Availability {
  ok: number;
  maybe: number;
  /** そのジャンルの人数 */
  total: number;
}

export type AvailabilityLookup = (
  date: string,
  startTime: string,
  endTime: string,
  genreId: number,
) => Availability | null;

export function buildAvailability(input: PlanInput | null): AvailabilityLookup | null {
  if (!input) return null;
  const answered = input.members.filter((m) => Object.keys(input.answers[m.id] ?? {}).length > 0);
  if (answered.length === 0) return null;

  const byGenre = new Map<number, string[]>();
  for (const member of input.members) {
    for (const genreId of new Set(member.genres)) {
      const list = byGenre.get(genreId) ?? [];
      list.push(member.id);
      byGenre.set(genreId, list);
    }
  }

  // 日付 → 候補の時間 (重なりの大きいものを選ぶため)
  const windows = new Map<string, { start: number; end: number; startTime: string; endTime: string }[]>();
  for (const c of input.candidates) {
    const list = windows.get(c.date) ?? [];
    if (!list.some((w) => w.startTime === c.startTime && w.endTime === c.endTime)) {
      list.push({ start: minutes(c.startTime), end: minutes(c.endTime), startTime: c.startTime, endTime: c.endTime });
    }
    windows.set(c.date, list);
  }

  const cache = new Map<string, Availability | null>();
  return (date, startTime, endTime, genreId) => {
    const s0 = minutes(startTime);
    const e0 = minutes(endTime);
    let best: { startTime: string; endTime: string } | null = null;
    let bestOverlap = 0;
    for (const w of windows.get(date) ?? []) {
      const overlap = Math.min(e0, w.end) - Math.max(s0, w.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = w;
      }
    }
    if (!best) return null;
    const key = answerKey(date, best.startTime, best.endTime);
    const cacheKey = `${key}#${genreId}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;
    const ids = byGenre.get(genreId) ?? [];
    let ok = 0;
    let maybe = 0;
    for (const id of ids) {
      const answer = input.answers[id]?.[key];
      if (answer === "ok") ok += 1;
      else if (answer === "maybe") maybe += 1;
    }
    const result = { ok, maybe, total: ids.length };
    cache.set(cacheKey, result);
    return result;
  };
}

/** 人の集まり具合 (0〜1)。△ は半分として数える */
export function availabilityRatio(a: Availability): number {
  return a.total === 0 ? 0 : (a.ok + a.maybe / 2) / a.total;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
