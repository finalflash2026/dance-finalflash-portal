import { writeAuditLog } from "@/lib/admin";
import { requireRole } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

/**
 * POST /api/admin/users/[id]/delete  (SPEC.md §8.9 / §6.5)
 *
 * SPEC では `DELETE /api/admin/users/[id]` だが、**誤操作の入口を減らすため
 * POST の専用パスにしている**。同じ URL に PATCH と DELETE を並べると、
 * メソッド1文字の間違いが「更新のつもりが削除」になる。
 *
 * **卒業処理には使わない** (SPEC §6.5: 原則OB移行)。用途は誤登録アカウントの整理。
 *
 * profiles を参照している外部キーのうち、`on delete cascade` が付いていないものは
 * ここで先に確認して 409 で止める。黙って消せない/消してはいけないものがあるのに
 * 「削除できません (permission denied)」とだけ返っても、admin は何をすればよいか
 * 分からないため、何が残っているかを数えて日本語で返す。
 */
export const runtime = "nodejs";

/** profiles を参照していて cascade が付いていないテーブル (SPEC §5.2) */
const BLOCKERS: { table: string; column: string; label: string }[] = [
  { table: "numbers", column: "owner_id", label: "主催しているナンバー" },
  { table: "reservations", column: "created_by", label: "登録した予約枠" },
  { table: "import_files", column: "uploaded_by", label: "取り込んだCSV" },
  { table: "room_status", column: "updated_by", label: "施錠状況の切替記録" },
  { table: "admin_audit_logs", column: "actor_id", label: "管理操作の記録" },
];

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof Response) return guard;
  const actor = guard;

  const { id } = await params;

  // 自己削除は禁止 (最後のadminが消えるのを防ぐ。SPEC §6.5)
  if (id === actor.user_id) {
    return Response.json(
      { error: "自分自身のアカウントは削除できません" },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("user_id, username, generation, main_genre_id, display_name, role")
    .eq("user_id", id)
    .maybeSingle<Profile>();

  if (targetError) {
    return Response.json(
      { error: `DBに接続できませんでした: ${targetError.message}` },
      { status: 503 },
    );
  }
  if (!target) {
    return Response.json(
      { error: "そのユーザーは見つかりません" },
      { status: 404 },
    );
  }

  // ---- 消せない参照が残っていないか ----
  const blocking: string[] = [];
  for (const blocker of BLOCKERS) {
    const { count, error } = await admin
      .from(blocker.table)
      .select(blocker.column, { count: "exact", head: true })
      .eq(blocker.column, id);

    if (error) {
      return Response.json(
        { error: `確認に失敗しました (${blocker.table}): ${error.message}` },
        { status: 503 },
      );
    }
    if ((count ?? 0) > 0) blocking.push(`${blocker.label} ${count}件`);
  }

  if (blocking.length > 0) {
    return Response.json(
      {
        error:
          `${target.username} は活動の記録が残っているため削除できません (${blocking.join(" / ")})。` +
          "卒業ならOB/OGへの移行を使ってください。",
      },
      { status: 409 },
    );
  }

  // ---- 監査ログを先に書く ----
  // target_user_id は on delete set null なので、削除後に書くと誰の話か分からなくなる。
  // 先に書けば FK が自動で null になり、detail の username だけが残る
  const warning = await writeAuditLog(admin, {
    actorId: actor.user_id,
    targetUserId: id,
    action: "delete_user",
    detail: {
      username: target.username,
      generation: target.generation,
      main_genre_id: target.main_genre_id,
      role: target.role,
    },
  });

  // auth.users を消すと profiles 以下 (申請・出欠・所属・購読トークン) が cascade で消える
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return Response.json(
      { error: `削除に失敗しました: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.json({
    username: target.username,
    ...(warning ? { warning } : {}),
  });
}
