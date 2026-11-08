import assert from "node:assert/strict";
import { test } from "node:test";

import { fillUnanswered } from "./fill";
import type { PlanInput } from "./types";

const input: PlanInput = {
  genres: [{ id: 1, code: "BREAK" }],
  candidates: [
    { id: "c1", date: "2027-01-04", section: "講堂", roomId: 1, startTime: "18:00", endTime: "19:30" },
    { id: "c2", date: "2027-01-04", section: "講堂", roomId: 1, startTime: "19:40", endTime: "21:10" },
  ],
  members: [
    { id: "a", name: "答えた人", genres: [1] },
    { id: "b", name: "答えていない人", genres: [1] },
  ],
  answers: { a: { "2027-01-04|18:00-19:30": "no" } },
};

test("回答の無い人は全部 ○、回答した人はそのまま", () => {
  const filled = fillUnanswered(input);
  assert.deepEqual(filled.answers.a, { "2027-01-04|18:00-19:30": "no" });
  assert.deepEqual(filled.answers.b, {
    "2027-01-04|18:00-19:30": "ok",
    "2027-01-04|19:40-21:10": "ok",
  });
  // 元の入力は変えない
  assert.equal(input.answers.b, undefined);
});
