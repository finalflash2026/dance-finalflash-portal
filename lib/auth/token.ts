import "server-only";

import { randomBytes } from "node:crypto";

/**
 * 購読URL用トークンの生成 (SPEC.md §8.1 / §13.2)
 *
 * 「32byte乱数(base64url)」。このトークン自体が鍵で、
 * 知っている人は認証なしにその人の予定を読めるため、必ず CSPRNG を使う。
 * 漏洩時は本人が設定画面から再発行する (§6.4.1 / §8.7)。
 */
export function generateCalendarToken(): string {
  return randomBytes(32).toString("base64url");
}
