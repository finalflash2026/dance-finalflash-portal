/**
 * 合言葉3種を bcrypt ハッシュ化して app_settings に投入する (SPEC.md §14-4 / §3.5)
 *
 *   実行: npm run set-passphrase
 *
 * 対象キー:
 *   signup_pass      … サークル生合言葉 (サインアップ時に必要, §3.2)
 *   coordinator_pass … 折衝パスワード   (ロール昇格, §3.4)
 *   admin_pass       … 管理者パスワード (ロール昇格, §3.4)
 *
 * 空入力でスキップできるので、1つだけ変更したいときにも使える。
 * **代替わり・卒業時には必ず変更すること** (SPEC §3.5)。
 *
 * 注意: service role key を使うため、このスクリプトは手元でのみ実行する。
 *       lib/supabase/admin.ts は "server-only" を含み Node 単体では動かないため、
 *       ここではクライアントを直接組み立てている。
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const KEYS = [
  { key: "signup_pass", label: "サークル生合言葉 (signup_pass)" },
  { key: "coordinator_pass", label: "折衝パスワード (coordinator_pass)" },
  { key: "admin_pass", label: "管理者パスワード (admin_pass)" },
] as const;

const BCRYPT_ROUNDS = 10;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      [
        "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です。",
        "",
        "  cp .env.example .env.local",
        "  # .env.local に Supabase の値を記入してから再実行",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rl = createInterface({ input: stdin, output: stdout });
  console.log("合言葉を設定します (空のままEnterでスキップ)\n");

  const updates: { key: string; value_hash: string }[] = [];
  for (const { key, label } of KEYS) {
    const answer = (await rl.question(`${label}: `)).trim();
    if (!answer) {
      console.log("  → スキップ");
      continue;
    }
    updates.push({ key, value_hash: await bcrypt.hash(answer, BCRYPT_ROUNDS) });
  }
  rl.close();

  if (updates.length === 0) {
    console.log("\n変更はありませんでした。");
    return;
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(updates, { onConflict: "key" });

  if (error) {
    console.error("\n失敗しました:", error.message);
    process.exit(1);
  }

  console.log(
    `\n完了: ${updates.map((u) => u.key).join(", ")} を更新しました (bcrypt)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
