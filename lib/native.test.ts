import assert from "node:assert/strict";
import { test } from "node:test";

import { appUrlToPath } from "./native";

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
