import assert from "node:assert/strict";
import test from "node:test";

import { buildCalendar } from "./ics";
import type { MyEvent } from "./types";

const base: MyEvent = {
  kind: "event",
  sourceId: "e1",
  sourceIds: ["e1"],
  date: "2026-11-03",
  startTime: "13:00",
  endTime: "17:00",
  title: "総会",
  location: "講堂",
  numberId: null,
  genreCode: null,
};

/** 折り返しを戻して1行ずつにする */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

test("メモは DESCRIPTION に出し、改行とカンマはエスケープする (v1.32.5)", () => {
  const lines = unfold(buildCalendar([{ ...base, note: "持ち物: 上履き, 水\n集合 12:50" }], "u"));
  assert.ok(lines.includes("DESCRIPTION:持ち物: 上履き\\, 水\\n集合 12:50"));
});

test("メモが無ければ DESCRIPTION を出さない", () => {
  for (const note of [undefined, null, "  "]) {
    const ics = buildCalendar([{ ...base, note }], "u");
    assert.ok(!ics.includes("DESCRIPTION"), String(note));
  }
});
