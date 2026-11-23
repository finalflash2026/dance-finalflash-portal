import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveMonthGenerations, followsMonth, type SlotInfo } from "./slots";

function slot(id: string, targetGenerations: number[] | null, status: SlotInfo["status"] = "genre"): SlotInfo {
  return {
    id,
    startTime: "19:00",
    endTime: "21:00",
    status,
    genreId: status === "genre" ? 1 : null,
    targetGenerations,
    published: true,
    claims: [],
  };
}

describe("deriveMonthGenerations (v1.50.4)", () => {
  it("一番多い対象期を月の対象期にし、違うコマを数える", () => {
    const result = deriveMonthGenerations([
      slot("a", [24, 23]),
      slot("b", [23, 24]),
      slot("c", [24]),
      slot("d", null, "open"),
    ]);
    assert.deepEqual(result.value, [24, 23]);
    assert.equal(result.following, 2);
    assert.equal(result.custom, 1);
  });

  it("公式練が無い月は全期", () => {
    assert.deepEqual(deriveMonthGenerations([slot("a", null, "open")]), {
      value: null,
      custom: 0,
      following: 0,
    });
  });

  it("空の配列は全期として数える", () => {
    const result = deriveMonthGenerations([slot("a", []), slot("b", null), slot("c", [24])]);
    assert.equal(result.value, null);
    assert.equal(result.custom, 1);
  });
});

describe("followsMonth", () => {
  it("並びが違っても同じ期なら月と同じ", () => {
    assert.equal(followsMonth([23, 24], [24, 23]), true);
    assert.equal(followsMonth(null, []), true);
    assert.equal(followsMonth([24], [24, 23]), false);
  });
});
