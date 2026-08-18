import { z } from "zod";

import { graduateToOb, writeAuditLogs } from "@/lib/admin";
import { requireRole } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

/**
 * POST /api/admin/users/bulk-graduate  (SPEC.md §8.9 / §6.5 / §3.6)
 *
 * 卒業する期をまとめてOB/OGへ移行する。
 * 1人ずつ PATCH を叩くのと違い、**削除処理を1回のトランザクションで済ませる**。
 *
 * OB化に伴う自動処理 (未来の申請・公式練の出欠・サブジャンルの削除) は
 * DB 関数 graduate_to_ob が行う。ここは対象の絞り込みと監査ログだけ。
 */
export const runtime = "nodejs";

const schema = z.object({
  userIds: z
    .array(z.string().uuid("ユーザーIDが不正です"))
    .min(1, "対象を選んでください")
    // 期ひとつ分でも数十人。取り違えて全員を送るような誤操作を上限で止める
    .max(200, "一度に移行できるのは200人までです"),
});

export async function POST(request: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof Response) return guard;
  const actor = guard;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容が不正です" },
      { status: 400 },
    );
  }

  const userIds = [...new Set(parsed.data.userIds)];

  // 自分をOBにすると管理者がいなくなる恐れがある (SPEC §6.5)。
  // 一括のときは黙って除くのではなく弾く — 選択の取り違えが疑われるため
  if (userIds.includes(actor.user_id)) {
    return Response.json(
      { error: "自分自身をOBへ移行することはできません" },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  // 監査ログに旧ロールを残したいので、変更前に引いておく
  const { data: targets, error: targetsError } = await admin
    .from("profiles")
    .select("user_id, username, role")
    .in("user_id", userIds);

  if (targetsError) {
    return Response.json(
      { error: `DBに接続できませんでした: ${targetsError.message}` },
      { status: 503 },
    );
  }

  const before = (targets ?? []) as Pick<
    Profile,
    "user_id" | "username" | "role"
  >[];
  const pending = before.filter((p) => p.role !== "ob");

  if (pending.length === 0) {
    return Response.json({ updated: 0, message: "移行対象がありませんでした" });
  }

  const result = await graduateToOb(
    admin,
    pending.map((p) => p.user_id),
  );
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 500 });
  }

  const warning = await writeAuditLogs(
    admin,
    pending.map((p) => ({
      actorId: actor.user_id,
      targetUserId: p.user_id,
      action: "graduate_ob" as const,
      detail: {
        before: { username: p.username, role: p.role },
        after: { username: p.username, role: "ob" },
        bulk: true,
      },
    })),
  );

  return Response.json({
    updated: result.updated,
    ...(warning ? { warning } : {}),
  });
}
