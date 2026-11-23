import assert from "node:assert/strict";
import { test } from "node:test";

import { PAGE_SIZE, selectAll } from "./select-all";

/** 1000行で切る PostgREST のまね */
function fakeTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const build = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + PAGE_SIZE)), error: null });
  };
  return { build, calls };
}

test("1000行を超えても全部読む", async () => {
  const { build, calls } = fakeTable(2345);
  const { data, error } = await selectAll(build);
  assert.equal(error, null);
  assert.equal(data.length, 2345);
  assert.deepEqual(data.at(-1), { id: 2344 });
  assert.equal(calls.length, 3);
});

test("ちょうど1000行なら、もう1回だけ確かめて終える", async () => {
  const { build, calls } = fakeTable(1000);
  const { data } = await selectAll(build);
  assert.equal(data.length, 1000);
  assert.equal(calls.length, 2);
});

test("1000行未満は1回で終える", async () => {
  const { build, calls } = fakeTable(767);
  const { data } = await selectAll(build);
  assert.equal(data.length, 767);
  assert.equal(calls.length, 1);
});

test("エラーはそのまま返す", async () => {
  const error = { name: "PostgrestError", code: "42P01", message: "x", details: "", hint: "" };
  const { error: got } = await selectAll(() => Promise.resolve({ data: null, error: error as never }));
  assert.equal(got, error);
});
