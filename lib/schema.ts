import "server-only";

import { hasSupabaseEnv } from "@/lib/env";
import { isMissingRelation } from "@/lib/schema-errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DB が大規模アップデートの SQL (0020〜0029) まで済んでいるか (SPEC.md §13.4 / v1.49)
 *
 * 本番の DB を変えずにコードだけ先に出せるようにするため、**新しい表があるかをサーバーで確かめ**、
 * 無ければその機能を隠して前の書き方に戻す。SQL を流せば、コードを変えずに機能が出る。
 *
 * - 確かめるのは 0028 の `schedule_answers` (0020〜0028 を番号順に流すので、最後の表を見る)
 * - 結果は1分だけ覚える (画面を開くたびに問い合わせない)
 * - 表が無いと分かったときだけ「無い」。DB が応答しないときは前の結果か「無い」に倒す
 * - Supabase の無い手元の見本は全部出す
 */
const TTL_MS = 60_000;
let cached: { value: boolean; at: number } | null = null;

export async function hasSchemaV2(): Promise<boolean> {
  if (!hasSupabaseEnv()) return true;
  // 確かめずに前の DB として動かす (試すとき・SQL を流す前に戻したいとき)
  if (process.env.DB_SCHEMA === "v1") return false;
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    // head: true にしない。HEAD では表が無くてもエラーが返らない (本文が無いため)
    const { error } = await createAdminClient()
      .from("schedule_answers")
      .select("round_id")
      .limit(1);
    const value = !error;
    if (error && !isMissingRelation(error)) {
      console.error("[schema] 表を確かめられませんでした", error);
      return cached?.value ?? false;
    }
    cached = { value, at: now };
    return value;
  } catch (cause) {
    console.error("[schema] 表を確かめられませんでした", cause);
    return cached?.value ?? false;
  }
}
