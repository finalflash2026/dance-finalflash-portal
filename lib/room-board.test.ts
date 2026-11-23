import assert from "node:assert/strict";
import { test } from "node:test";

import { carriedOpenRows, usedRoomIds } from "./room-board";

test("今日使う部屋は、公式練か空きのある部屋 (使えない部屋だけ除く)", () => {
  assert.deepEqual(
    usedRoomIds([
      { room_id: 1, status: "genre", claims: [] },
      { room_id: 2, status: "open", claims: [] },
      { room_id: 3, status: "open", claims: [{ id: "c" }] },
      { room_id: 4, status: "unavailable", claims: [] },
      { room_id: 1, status: "open", claims: [] },
    ]).sort(),
    [1, 2, 3],
  );
});

test("前日から開いたままは、前日開いていて今日まだ報告の無い部屋", () => {
  const row = (room_id: number, is_unlocked: boolean) => ({
    room_id,
    is_unlocked,
    updated_at: "2026-11-22T13:00:00Z",
    profiles: null,
  });
  assert.deepEqual(
    carriedOpenRows([row(1, true), row(2, false), row(3, true)], [3]).map((r) => r.room_id),
    [1],
  );
});
