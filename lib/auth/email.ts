import "server-only";

import { createHash } from "node:crypto";

/**
 * Supabase Auth 用のダミーメール合成 (SPEC.md §3.2)
 *
 * このサイトはメールアドレスを使わないが、Supabase Auth はメールを必須とするため
 * username から決定的に合成する。同じ username からは常に同じメールが出るので、
 * ログイン時 (§3.3) にも同じ関数で再合成してログインできる。
 *
 *   u_{sha256(username)先頭16桁}@noemail.example.com
 *
 * 注意: username を変更する (§6.5.1 の1ジャン・期の修正) とメールも変わるため、
 * admin による username 再生成時は auth.users のメールも更新する必要がある。
 */
export function dummyEmail(username: string): string {
  const hash = createHash("sha256").update(username, "utf8").digest("hex");
  return `u_${hash.slice(0, 16)}@noemail.example.com`;
}
