import assert from "node:assert/strict";
import test from "node:test";

import { candidatesFromReservations } from "./candidates";

test("予約枠を過去の表と同じコマの区切りに割る (v1.35)", () => {
  const c = candidatesFromReservations([
    { date: "2026-12-02", startTime: "18:00", endTime: "21:10", roomId: 1, section: "7号館" },
    { date: "2026-12-02", startTime: "18:00", endTime: "21:40", roomId: 2, section: "フレスコ" },
    { date: "2026-12-05", startTime: "13:00", endTime: "21:10", roomId: 3, section: "フレスコ" },
  ]);
  const ranges = (roomId: number) => c.filter((x) => x.roomId === roomId).map((x) => `${x.startTime}-${x.endTime}`);
  assert.deepEqual(ranges(1), ["18:00-19:30", "19:40-21:10"]);
  assert.deepEqual(ranges(2), ["18:00-19:10", "19:15-20:25", "20:30-21:40"]);
  assert.equal(ranges(3).length, 5);
});

test("区切りが合わない予約枠は、そのまま1コマにする", () => {
  const c = candidatesFromReservations([
    { date: "2026-12-03", startTime: "17:30", endTime: "19:30", roomId: 14, section: "南大沢市民センター" },
  ]);
  assert.deepEqual(c.map((x) => `${x.startTime}-${x.endTime}`), ["17:30-19:30"]);
});
