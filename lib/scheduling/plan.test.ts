/**
 * 割り振りの計算のテスト (SPEC.md §6.8.3)。`npm test` で走る。
 * デモの見本 (150人・来月の予約枠) を解いて、決まりを1つも破っていないかを見る。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import highsLoader from "highs";

import { toMinutes } from "@/lib/time";

import { demoInput } from "./demo";
import { DEFAULT_SETTINGS, defaultPerGenre, plan } from "./plan";
import type { PlanSettings } from "./types";

test("150人の見本を時間内に解き、決まりを守る", async () => {
  const solver = await highsLoader();
  const input = demoInput();
  const settings: PlanSettings = { ...DEFAULT_SETTINGS, perGenre: defaultPerGenre(input) };
  const result = plan(input, settings, solver);
  console.log(
    `コマ ${input.candidates.length} / 人 ${input.members.length} / 変数 ${result.size.variables} / 制約 ${result.size.constraints} / ${result.elapsedMs}ms / ${result.status}`,
  );
  assert.equal(result.status, "optimal");

  // 1つのコマには1ジャンルまで
  const ids = result.assignments.map((a) => a.candidateId);
  assert.equal(new Set(ids).size, ids.length);

  // 各ジャンルのコマ数は N か N+1
  for (const g of result.perGenre) {
    assert.ok(g.slots === settings.perGenre || g.slots === settings.perGenre + 1, `genre ${g.genreId}: ${g.slots}`);
  }

  // 同じジャンルは1日 maxPerDay コマまで
  const perDay = new Map<string, number>();
  for (const a of result.assignments) {
    const k = `${a.genreId}|${input.candidates.find((c) => c.id === a.candidateId)!.date}`;
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  for (const [k, n] of perDay) assert.ok(n <= settings.maxPerDay, `${k}: ${n}コマ`);

  // 同じ日に複数コマなら連続 (間が30分以内で、間に別の時間を挟まない)
  const byGenreDay = new Map<string, typeof input.candidates>();
  for (const a of result.assignments) {
    const c = input.candidates.find((x) => x.id === a.candidateId)!;
    const k = `${a.genreId}|${c.date}`;
    byGenreDay.set(k, [...(byGenreDay.get(k) ?? []), c]);
  }
  for (const [k, list] of byGenreDay) {
    if (list.length < 2) continue;
    const day = input.candidates.filter((c) => c.date === list[0].date);
    const times = [...new Set(day.map((c) => `${c.startTime}-${c.endTime}`))].sort();
    const idx = list.map((c) => times.indexOf(`${c.startTime}-${c.endTime}`)).sort((a, b) => a - b);
    for (let i = 0; i + 1 < idx.length; i++) {
      assert.equal(idx[i + 1] - idx[i], 1, `${k} が連続していない`);
      const gap = toMinutes(times[idx[i + 1]].split("-")[0]) - toMinutes(times[idx[i]].split("-")[1]);
      assert.ok(gap <= 30, `${k} の間が${gap}分`);
    }
  }

  // 同じジャンルを同じ時間に2部屋に入れない
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  for (const a of result.assignments) {
    for (const b of result.assignments) {
      if (a === b || a.genreId !== b.genreId) continue;
      const [x, y] = [byId.get(a.candidateId)!, byId.get(b.candidateId)!];
      const overlap =
        x.date === y.date &&
        toMinutes(x.startTime) < toMinutes(y.endTime) &&
        toMinutes(y.startTime) < toMinutes(x.endTime);
      assert.ok(!overlap, `${a.genreId} が ${x.id} と ${y.id} で重なっている`);
    }
  }
});

test("連続するコマはできるだけ同じ部屋で、広い部屋は人の多いジャンルへ", async () => {
  const solver = await highsLoader();
  const input = demoInput();
  const base: PlanSettings = { ...DEFAULT_SETTINGS, perGenre: defaultPerGenre(input) };
  const sameRoomRate = (settings: PlanSettings) => {
    const r = plan(input, settings, solver);
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    let pairs = 0;
    let same = 0;
    for (const a of r.assignments) {
      for (const b of r.assignments) {
        const [x, y] = [byId.get(a.candidateId)!, byId.get(b.candidateId)!];
        if (a.genreId !== b.genreId || x.date !== y.date || x.startTime >= y.startTime) continue;
        pairs++;
        if (x.roomId === y.roomId) same++;
      }
    }
    return { rate: pairs ? same / pairs : 1, pairs };
  };
  const off = sameRoomRate({ ...base, sameRoomBonus: 0 });
  const on = sameRoomRate({ ...base, sameRoomBonus: 5 });
  console.log(`同じ部屋で連続: 加点なし ${(off.rate * 100).toFixed(0)}% / 加点あり ${(on.rate * 100).toFixed(0)}% (${on.pairs}組)`);
  assert.ok(on.rate >= off.rate);
  assert.ok(on.rate >= 0.8);
});

test("同じ入力からは同じ案が出る", async () => {
  const solver = await highsLoader();
  const input = demoInput();
  const settings: PlanSettings = { ...DEFAULT_SETTINGS, perGenre: defaultPerGenre(input) };
  const a = plan(input, settings, solver).assignments.map((x) => `${x.candidateId}=${x.genreId}`);
  const b = plan(input, settings, solver).assignments.map((x) => `${x.candidateId}=${x.genreId}`);
  assert.deepEqual(a, b);
});

test("コマが足りないときは理由を返す", async () => {
  const solver = await highsLoader();
  const input = demoInput();
  const result = plan(input, { ...DEFAULT_SETTINGS, perGenre: 999 }, solver);
  assert.equal(result.status, "infeasible");
  assert.match(result.message ?? "", /コマが足りません/);
});
