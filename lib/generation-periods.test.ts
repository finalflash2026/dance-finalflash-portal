import assert from "node:assert/strict";
import { test } from "node:test";

import {
  affectedRange,
  applyPeriod,
  changedSlots,
  describeOtherChanges,
  formatGenerations,
  normalizeGenerations,
  removePeriod,
  sameTarget,
  targetOn,
  validatePeriodDraft,
  type GenerationPeriod,
} from "./generation-periods";
import type { DateString } from "./types";

const d = (s: string) => s as DateString;

function period(
  id: string,
  startDate: string,
  endDate: string,
  generations: number[] | null,
  name: string | null = null,
): GenerationPeriod {
  return { id, name, startDate: d(startDate), endDate: d(endDate), generations, updatedAt: "t" };
}

const shape = (list: { id: string | null; startDate: string; endDate: string; generations: number[] | null }[]) =>
  list.map((p) => `${p.id ?? "new"} ${p.startDate}..${p.endDate} ${formatGenerations(p.generations)}`);

test("対象期は大きい期から並べ、同じ期は1つ。空は全期", () => {
  assert.deepEqual(normalizeGenerations([23, 24, 23]), [24, 23]);
  assert.equal(normalizeGenerations([]), null);
  assert.equal(normalizeGenerations(null), null);
  assert.equal(formatGenerations([24, 23]), "24・23期");
  assert.equal(formatGenerations(null), "全期");
});

test("DB と同じく、対象期は並びまで比べる", () => {
  assert.equal(sameTarget(null, null), true);
  assert.equal(sameTarget([24], null), false);
  assert.equal(sameTarget([24, 23], [24, 23]), true);
  assert.equal(sameTarget([23, 24], [24, 23]), false);
});

test("その日の対象期。どの期間にも入らなければ全期", () => {
  const periods = [period("a", "2026-08-10", "2026-11-15", null), period("b", "2026-11-16", "2026-12-12", [24])];
  assert.equal(targetOn(periods, d("2026-08-09")), null);
  assert.equal(targetOn(periods, d("2026-11-15")), null);
  assert.deepEqual(targetOn(periods, d("2026-11-16")), [24]);
  assert.deepEqual(targetOn(periods, d("2026-12-12")), [24]);
  assert.equal(targetOn(periods, d("2026-12-13")), null);
});

test("保存する期間が優先: 片側だけ重なる期間は短くする", () => {
  const before = [period("nov", "2026-11-01", "2026-11-30", [24, 23]), period("dec", "2026-12-01", "2026-12-31", [24])];
  const after = applyPeriod(before, {
    id: null,
    name: "クリスマス",
    startDate: d("2026-11-16"),
    endDate: d("2026-12-12"),
    generations: [24],
  });
  assert.deepEqual(shape(after), [
    "nov 2026-11-01..2026-11-15 24・23期",
    "new 2026-11-16..2026-12-12 24期",
    "dec 2026-12-13..2026-12-31 24期",
  ]);
  assert.deepEqual(describeOtherChanges(before, after, null), [
    "11/1(日)〜11/30(月) → 11/1(日)〜11/15(日)",
    "12/1(火)〜12/31(木) → 12/13(日)〜12/31(木)",
  ]);
});

test("中に収まる期間は消え、両側にはみ出す期間は2つに分かれる", () => {
  const inside = [period("x", "2026-11-05", "2026-11-06", [23], "合宿")];
  const covered = applyPeriod(inside, { id: null, name: null, startDate: d("2026-11-01"), endDate: d("2026-11-30"), generations: [] });
  assert.deepEqual(shape(covered), ["new 2026-11-01..2026-11-30 全期"]);
  assert.deepEqual(describeOtherChanges(inside, covered, null), ["合宿 11/5(木)〜11/6(金) を消す"]);

  const outer = [period("w", "2026-11-01", "2026-11-30", [24])];
  const split = applyPeriod(outer, { id: null, name: null, startDate: d("2026-11-10"), endDate: d("2026-11-12"), generations: [25] });
  assert.deepEqual(shape(split), [
    "w 2026-11-01..2026-11-09 24期",
    "new 2026-11-10..2026-11-12 25期",
    "new 2026-11-13..2026-11-30 24期",
  ]);
  assert.deepEqual(describeOtherChanges(outer, split, null), [
    "11/1(日)〜11/30(月) → 11/1(日)〜11/9(月) と 11/13(金)〜11/30(月)",
  ]);
});

test("編集する期間そのものは片付けの対象にしない。触らない期間は何も言わない", () => {
  const before = [period("a", "2026-11-01", "2026-11-10", [24]), period("b", "2026-12-01", "2026-12-10", [23])];
  const after = applyPeriod(before, { id: "a", name: null, startDate: d("2026-11-05"), endDate: d("2026-11-20"), generations: [24] });
  assert.deepEqual(shape(after), ["a 2026-11-05..2026-11-20 24期", "b 2026-12-01..2026-12-10 23期"]);
  assert.deepEqual(describeOtherChanges(before, after, "a"), []);
});

test("入れ直す範囲は前の範囲と新しい範囲の両端", () => {
  assert.deepEqual(
    affectedRange({ startDate: d("2026-11-01"), endDate: d("2026-11-10") }, { startDate: d("2026-11-20"), endDate: d("2026-11-25") }),
    { from: "2026-11-01", to: "2026-11-25" },
  );
  assert.deepEqual(affectedRange(null, { startDate: d("2026-11-20"), endDate: d("2026-11-25") }), { from: "2026-11-20", to: "2026-11-25" });
  assert.equal(affectedRange(null, null), null);
});

test("対象期が変わる公開済みのコマ: 今日から先・範囲の中・値が違うものだけ", () => {
  const slots = [
    { id: "past", date: d("2026-11-20"), targetGenerations: [24, 23] },
    { id: "same", date: d("2026-11-25"), targetGenerations: [24] },
    { id: "change", date: d("2026-11-26"), targetGenerations: [24, 23] },
    { id: "outside", date: d("2027-01-11"), targetGenerations: [23] },
  ];
  const after = [period("p", "2026-11-16", "2026-12-12", [24])];
  const changed = changedSlots(slots, after, { from: d("2026-11-16"), to: d("2026-12-12") }, d("2026-11-23"));
  assert.deepEqual(changed.map((s) => s.id), ["change"]);
  assert.deepEqual(changedSlots(slots, after, null, d("2026-11-23")), []);
});

test("消すと、その範囲は全期に戻る", () => {
  const before = [period("a", "2026-11-01", "2026-11-30", [24])];
  const after = removePeriod(before, "a");
  const slots = [{ id: "s", date: d("2026-11-25"), targetGenerations: [24] }];
  assert.deepEqual(changedSlots(slots, after, { from: d("2026-11-01"), to: d("2026-11-30") }, d("2026-11-23")).map((s) => s.id), ["s"]);
});

test("保存の前の確かめ", () => {
  const draft = { id: null, updatedAt: null, name: "", startDate: d("2026-11-16"), endDate: d("2026-12-12"), generations: [] };
  assert.equal(validatePeriodDraft(draft), null);
  assert.match(validatePeriodDraft({ ...draft, endDate: d("2026-11-15") }) ?? "", /前/);
  assert.match(validatePeriodDraft({ ...draft, startDate: d("") }) ?? "", /入れて/);
  assert.match(validatePeriodDraft({ ...draft, name: "あ".repeat(41) }) ?? "", /40文字/);
});
