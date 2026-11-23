import assert from "node:assert/strict";
import { test } from "node:test";

import { availabilityRatio, buildAvailability } from "./availability";
import type { PlanInput } from "./types";

const input: PlanInput = {
  genres: [
    { id: 1, code: "BREAK" },
    { id: 2, code: "HIPHOP" },
  ],
  candidates: [
    { id: "c1", date: "2027-01-04", section: "講堂", roomId: 1, startTime: "18:00", endTime: "19:30" },
    { id: "c2", date: "2027-01-04", section: "講堂", roomId: 1, startTime: "19:40", endTime: "21:10" },
  ],
  members: [
    { id: "a", name: "A", genres: [1] },
    { id: "b", name: "B", genres: [2, 1] },
    { id: "c", name: "C", genres: [2] },
  ],
  answers: {
    a: { "2027-01-04|18:00-19:30": "ok" },
    b: { "2027-01-04|18:00-19:30": "maybe" },
  },
};

test("ジャンルの人 (2/3ジャンを含む) の ○ と △ を数える", () => {
  const lookup = buildAvailability(input)!;
  assert.deepEqual(lookup("2027-01-04", "18:00", "19:30", 1), { ok: 1, maybe: 1, total: 2 });
  assert.deepEqual(lookup("2027-01-04", "18:00", "19:30", 2), { ok: 0, maybe: 1, total: 2 });
  assert.deepEqual(lookup("2027-01-04", "19:40", "21:10", 1), { ok: 0, maybe: 0, total: 2 });
  // 表のコマの時間がずれていても、一番重なる候補の回答を使う
  assert.deepEqual(lookup("2027-01-04", "17:00", "19:00", 1), { ok: 1, maybe: 1, total: 2 });
  // 重ならなければ出さない
  assert.equal(lookup("2027-01-04", "13:00", "14:50", 1), null);
  assert.equal(lookup("2027-01-05", "18:00", "19:30", 1), null);
  assert.equal(availabilityRatio({ ok: 1, maybe: 1, total: 2 }), 0.75);
});

test("回答が1件も無ければ出さない", () => {
  assert.equal(buildAvailability({ ...input, answers: {} }), null);
  assert.equal(buildAvailability(null), null);
});
