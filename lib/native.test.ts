import assert from "node:assert/strict";
import { test } from "node:test";

import { appUrlToPath, safeAppPath } from "./native";

test("Google から戻ったコードを /auth/callback に渡す", () => {
  assert.equal(
    appUrlToPath("ffcalendar://auth/callback?code=abc-123"),
    "/auth/callback?code=abc-123",
  );
});

test("コードが無ければログイン画面に理由を付けて戻す", () => {
  assert.equal(
    appUrlToPath("ffcalendar://auth/callback?error=access_denied"),
    "/login?error=google",
  );
});

test("知らない URL は無視する", () => {
  assert.equal(appUrlToPath("ffcalendar://other"), null);
  assert.equal(appUrlToPath("https://example.com/auth/callback?code=x"), null);
});

test("ウィジェットから開く画面を読み取る", () => {
  assert.equal(
    appUrlToPath("ffcalendar://open?path=%2F%3Fdate%3D2026-11-09"),
    "/?date=2026-11-09",
  );
});

test("サイトの外へ出る道順は開かない", () => {
  assert.equal(appUrlToPath("ffcalendar://open?path=https://evil.example"), null);
  assert.equal(safeAppPath("//evil.example"), null);
  assert.equal(safeAppPath("/numbers/1"), "/numbers/1");
});
