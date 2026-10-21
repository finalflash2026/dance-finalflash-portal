import assert from "node:assert/strict";
import test from "node:test";

import { dbErrorMessage } from "./error-message";

test("知っているコードは言い換え、英語の原文は出さない", () => {
  const text = dbErrorMessage("保存できませんでした", {
    code: "42501",
    message: 'new row violates row-level security policy for table "slots"',
  });
  assert.match(text, /^保存できませんでした。この操作をする権限がありません/);
  assert.ok(!text.includes("row-level"));
});

test("通信の失敗はコードが無くても分かる", () => {
  assert.match(dbErrorMessage("削除できませんでした", { message: "TypeError: Failed to fetch" }), /通信できませんでした/);
});

test("知らないエラーは詳細として後ろに添える", () => {
  assert.equal(
    dbErrorMessage("保存できませんでした", { code: "XX000", message: "boom" }),
    "保存できませんでした。時間をおいてもう一度試してください (詳細: boom)",
  );
});
