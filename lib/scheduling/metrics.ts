/**
 * 案の採点 (SPEC §6.8.6)。条件の学習と、結果の画面に出す数字に使う。
 *
 *   参加率       1ジャンの練習のうち、出られる (○ = 1, △ = 0.5) 回の割合の平均
 *   下位1割      上の割合の、低いほうから1割の人の平均 (偏りが少ないほど高い)
 *   広さの合い方 ジャンルの人数と、そのジャンルが使った部屋の広さの平均の順位相関 (-1〜1)
 *   広い部屋     ジャンルごとの広い部屋の回数のうち、一番少ないもの
 */
import { keyOf } from "./plan";
import { DEFAULT_ROOM_SIZES, sizeWeight } from "./rooms";
import type { PlanInput, PlanResult, PlanSettings } from "./types";

export interface PlanMetrics {
  participation: number;
  bottom10: number;
  sizeFit: number;
  minBigRooms: number;
}

/** 採点の重み。学習で何を良しとするかを決める (SPEC §6.8.6) */
export const METRIC_WEIGHTS = { participation: 1, bottom10: 0.6, sizeFit: 0.15, minBigRooms: 0.05 };

export function totalScore(m: PlanMetrics): number {
  return (
    m.participation * METRIC_WEIGHTS.participation +
    m.bottom10 * METRIC_WEIGHTS.bottom10 +
    m.sizeFit * METRIC_WEIGHTS.sizeFit +
    Math.min(m.minBigRooms, 2) * METRIC_WEIGHTS.minBigRooms
  );
}

function rank(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  order.forEach(([, i], r) => (ranks[i] = r));
  return ranks;
}

function spearman(a: number[], b: number[]): number {
  if (a.length < 3) return 0;
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((sum, r, i) => sum + (r - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/**
 * 部屋の広さは、条件の重み (学習で変わる) ではなく**決まった基準** (DEFAULT_ROOM_SIZES) で測る。
 * 条件しだいで物差しが変わると、点を比べられないため
 */
const refSize = (roomId: number) => sizeWeight(DEFAULT_ROOM_SIZES[roomId] ?? "normal", 0.2);
const refBig = (roomId: number) => DEFAULT_ROOM_SIZES[roomId] === "large";

export function measure(input: PlanInput, settings: PlanSettings, result: PlanResult): PlanMetrics {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const value = (a: string | undefined) => (a === "ok" ? 1 : a === "maybe" ? settings.maybeWeight : 0);

  const rates: number[] = [];
  for (const member of input.members) {
    const answers = input.answers[member.id];
    if (!answers) continue;
    const mine = result.assignments.filter((a) => a.genreId === member.genres[0]);
    if (mine.length === 0) continue;
    const ok = mine.reduce((sum, a) => sum + value(answers[keyOf(byId.get(a.candidateId)!)]), 0);
    rates.push(ok / mine.length);
  }
  rates.sort((a, b) => a - b);
  const bottom = rates.slice(0, Math.max(1, Math.floor(rates.length / 10)));

  // ジャンルの人数 (1ジャン) と、使った部屋の広さの平均
  const sizes: number[] = [];
  const roomAvg: number[] = [];
  let minBig = Infinity;
  for (const genre of input.genres) {
    const mine = result.assignments.filter((a) => a.genreId === genre.id);
    if (mine.length === 0) continue;
    sizes.push(input.members.filter((m) => m.genres[0] === genre.id).length);
    roomAvg.push(
      mine.reduce((sum, a) => sum + refSize(byId.get(a.candidateId)!.roomId), 0) / mine.length,
    );
    minBig = Math.min(minBig, mine.filter((a) => refBig(byId.get(a.candidateId)!.roomId)).length);
  }

  return {
    participation: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0,
    bottom10: bottom.length ? bottom.reduce((a, b) => a + b, 0) / bottom.length : 0,
    sizeFit: spearman(sizes, roomAvg),
    minBigRooms: Number.isFinite(minBig) ? minBig : 0,
  };
}
