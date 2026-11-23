/**
 * 日程調整の条件を見本のデータで選ぶ (SPEC §6.8.6)。`npm run tune:schedule`
 *
 * 簡単な機械学習 (パラメータの探索):
 *   1. 見本の月を「選ぶ用 (学習)」と「確かめる用 (検証)」に分ける
 *   2. 条件をランダムに選んで、学習用の月すべてで案を作り、採点の平均を比べる
 *   3. 一番良かった条件を、検証用の月でも今の条件より良いか確かめる
 *   4. 良ければ lib/scheduling/learned.json に書く
 * 種を決めてあるので、何度走らせても同じ結果になる。
 */
import { writeFileSync } from "node:fs";

import highsLoader from "highs";

import learned from "../lib/scheduling/learned.json";
import { measure, totalScore, type PlanMetrics } from "../lib/scheduling/metrics";
import { DEFAULT_SETTINGS, defaultPerGenre, plan, type Solver } from "../lib/scheduling/plan";
import { DEFAULT_ROOM_SIZES, roomWeightsFor } from "../lib/scheduling/rooms";
import { random, scenario, TRAINING_SCENARIOS } from "../lib/scheduling/scenarios";
import type { PlanSettings } from "../lib/scheduling/types";

interface Params {
  sameRoomBonus: number;
  fairnessWeight: number;
  fairnessTarget: number;
  minBigPerGenre: number;
  roomStrength: number;
}

const SPACE = {
  sameRoomBonus: [0, 1, 2, 3, 5],
  fairnessWeight: [0, 0.5, 1, 2, 4, 8],
  fairnessTarget: [0.5, 0.6, 0.7, 0.8, 0.9],
  minBigPerGenre: [0, 1, 2],
  // 0 にすると「広い部屋」が無くなり、広い部屋の回数の決まりも効かなくなるので 0.1 から
  roomStrength: [0.1, 0.2, 0.3],
};
const TRIALS = Number(process.env.TRIALS ?? 30);

const inputs = TRAINING_SCENARIOS.map((s) => ({ ...s, input: scenario(s.month, s.kind, s.seed) }));
const train = inputs.filter((_, i) => i % 2 === 0);
const test = inputs.filter((_, i) => i % 2 === 1);

function settingsFor(p: Params, perGenre: number): PlanSettings {
  return {
    ...DEFAULT_SETTINGS,
    perGenre,
    sameRoomBonus: p.sameRoomBonus,
    fairnessWeight: p.fairnessWeight,
    fairnessTarget: p.fairnessTarget,
    minBigPerGenre: p.minBigPerGenre,
    roomWeights: roomWeightsFor(DEFAULT_ROOM_SIZES, p.roomStrength),
  };
}

function evaluate(solver: Solver, p: Params, set: typeof inputs) {
  const all: PlanMetrics[] = [];
  for (const { input } of set) {
    const settings = settingsFor(p, defaultPerGenre(input));
    const result = plan(input, settings, solver);
    if (result.status === "infeasible" || result.status === "error") return null;
    all.push(measure(input, settings, result));
  }
  const mean = (k: keyof PlanMetrics) => all.reduce((s, m) => s + m[k], 0) / all.length;
  const metrics: PlanMetrics = {
    participation: mean("participation"),
    bottom10: mean("bottom10"),
    sizeFit: mean("sizeFit"),
    minBigRooms: mean("minBigRooms"),
  };
  return { metrics, score: totalScore(metrics) };
}

const show = (m: PlanMetrics) =>
  `参加率 ${(m.participation * 100).toFixed(1)}% / 下位1割 ${(m.bottom10 * 100).toFixed(1)}% / 広さの合い方 ${m.sizeFit.toFixed(2)} / 広い部屋 最少${m.minBigRooms.toFixed(1)}回`;

void (async () => {
  const solver = await highsLoader();
  const rand = random(2026);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const current: Params = {
    sameRoomBonus: learned.sameRoomBonus,
    fairnessWeight: learned.fairnessWeight,
    fairnessTarget: learned.fairnessTarget,
    minBigPerGenre: learned.minBigPerGenre,
    roomStrength: learned.roomStrength,
  };
  const baseline: Params = { sameRoomBonus: 0, fairnessWeight: 0, fairnessTarget: 0.6, minBigPerGenre: 0, roomStrength: 0.1 };

  const base = evaluate(solver, baseline, train)!;
  console.log(`学習用 ${train.map((s) => s.name).join("・")} / 検証用 ${test.map((s) => s.name).join("・")}`);
  console.log(`[何もしない条件] 点 ${base.score.toFixed(4)}  ${show(base.metrics)}`);

  let best = { params: current, ...evaluate(solver, current, train)! };
  console.log(`[今の条件]       点 ${best.score.toFixed(4)}  ${show(best.metrics)}`);
  for (let t = 0; t < TRIALS; t++) {
    const p: Params = {
      sameRoomBonus: pick(SPACE.sameRoomBonus),
      fairnessWeight: pick(SPACE.fairnessWeight),
      fairnessTarget: pick(SPACE.fairnessTarget),
      minBigPerGenre: pick(SPACE.minBigPerGenre),
      roomStrength: pick(SPACE.roomStrength),
    };
    const r = evaluate(solver, p, train);
    if (!r) continue;
    const mark = r.score > best.score ? " ← 一番良い" : "";
    console.log(`試行${String(t + 1).padStart(2)} 点 ${r.score.toFixed(4)} ${JSON.stringify(p)}${mark}`);
    if (r.score > best.score) best = { params: p, ...r };
  }

  const testBase = evaluate(solver, baseline, test)!;
  const testCurrent = evaluate(solver, current, test)!;
  const testBest = evaluate(solver, best.params, test)!;
  console.log("\n--- 検証用の月で確かめる ---");
  console.log(`何もしない条件 点 ${testBase.score.toFixed(4)}  ${show(testBase.metrics)}`);
  console.log(`今の条件       点 ${testCurrent.score.toFixed(4)}  ${show(testCurrent.metrics)}`);
  console.log(`選んだ条件     点 ${testBest.score.toFixed(4)}  ${show(testBest.metrics)}`);
  console.log(`選んだ条件: ${JSON.stringify(best.params)}`);

  if (testBest.score >= testCurrent.score) {
    writeFileSync(
      new URL("../lib/scheduling/learned.json", import.meta.url),
      `${JSON.stringify({ note: learned.note, ...best.params }, null, 2)}\n`,
    );
    console.log("learned.json に書きました");
  } else {
    console.log("検証用の月で今の条件より悪かったので、learned.json は変えません");
  }
})();
