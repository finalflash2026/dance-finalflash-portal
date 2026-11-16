import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_HOME_LAYOUT, normalizeHomeLayout } from "./home-layout";

describe("normalizeHomeLayout", () => {
  it("空の値には既定の並びを返す", () => {
    assert.deepEqual(normalizeHomeLayout(null), DEFAULT_HOME_LAYOUT);
  });

  it("4つの欄しか保存されていない古い設定でも、staff を一番下に足す", () => {
    const result = normalizeHomeLayout({
      order: ["keys", "calendar", "deadlines", "freeRooms"],
      hidden: ["freeRooms"],
    });
    assert.deepEqual(result.order, ["keys", "calendar", "deadlines", "freeRooms", "staff"]);
    assert.deepEqual(result.hidden, ["freeRooms"]);
  });

  it("知らない欄は捨て、calendar は hidden に入れさせない", () => {
    const result = normalizeHomeLayout({
      order: ["staff", "unknown", "calendar"],
      hidden: ["calendar", "staff", "unknown"],
    });
    assert.equal(result.order[0], "staff");
    assert.equal(result.order.length, DEFAULT_HOME_LAYOUT.order.length);
    assert.deepEqual(result.hidden, ["staff"]);
  });
});
