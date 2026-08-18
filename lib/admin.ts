import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 管理者操作の共通処理 (SPEC.md §6.5 / §8.9)
 *
 * ここに置いてあるのは監査ログとOB化の呼び出しだけで、
 * **権限判定は入れない**。admin かどうかは各 API の requireRole("admin") が見る。
 */

/** admin_audit_logs.action に入る値。増やすときは意味が重ならないようにする */
export type AdminAction =
  | "update_profile" // 表示名・期・1ジャン・ロールの変更 (§6.5.1)
  | "graduate_ob" // OB/OGへ移行 (§3.6)
  | "restore_member" // 現役へ復帰 (§3.6)
  | "reset_password" // 仮パスワード再設定 (§3.5)
  | "delete_user" // アカウント削除
  | "update_passphrase"; // 合言葉変更 (§3.5)

/**
 * 監査ログを1行書く (SPEC §6.5.1「旧値→新値・実行者・日時を記録する」)。
 *
 * **失敗しても例外にしない。** 本体の変更は既に成功しているので、
 * ここで500にすると「変更されたのに失敗と表示される」ほうの害が大きい。
 * 呼び出し側は戻り値の文言を画面の警告として添えること
 * (黙って捨てると記録が無いことに誰も気付けない)。
 */
export interface AuditEntry {
  actorId: string;
  targetUserId: string | null;
  action: AdminAction;
  detail: Record<string, unknown>;
}

export async function writeAuditLog(
  admin: SupabaseClient,
  entry: AuditEntry,
): Promise<string | null> {
  return writeAuditLogs(admin, [entry]);
}

/**
 * 一括操作の監査ログ。**対象1人につき1行**書く。
 * 「誰をまとめて処理したか」より「この人に何が起きたか」を後から引けるほうが
 * 実際の問い合わせ (「なぜ自分がOBになっているのか」) に答えられる。
 */
export async function writeAuditLogs(
  admin: SupabaseClient,
  entries: AuditEntry[],
): Promise<string | null> {
  if (entries.length === 0) return null;

  const { error } = await admin.from("admin_audit_logs").insert(
    entries.map((entry) => ({
      actor_id: entry.actorId,
      target_user_id: entry.targetUserId,
      action: entry.action,
      detail: entry.detail,
    })),
  );
  return error ? `監査ログを残せませんでした: ${error.message}` : null;
}

/**
 * OB/OGへ移行する (SPEC §3.6)。
 *
 * 未来日の claims / 公式練 attendances / サブジャンルの削除とロール更新を
 * DB 関数 `graduate_to_ob` が1トランザクションで行う (0006 マイグレーション)。
 * **アプリ側で4本に分けて発行しないこと** —
 * 途中で失敗すると「OBなのに未来の申請が残る」状態になる。
 *
 * 戻り値は実際に role が変わった人数 (既にOBだった人は数えない)。
 */
export async function graduateToOb(
  admin: SupabaseClient,
  userIds: string[],
): Promise<{ updated: number } | { error: string }> {
  const { data, error } = await admin.rpc("graduate_to_ob", {
    p_user_ids: userIds,
  });

  if (error) {
    return { error: `OBへの移行に失敗しました: ${error.message}` };
  }
  return { updated: typeof data === "number" ? data : userIds.length };
}
