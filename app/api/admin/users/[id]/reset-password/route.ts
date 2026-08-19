import { generateTempPassword, writeAuditLog } from "@/lib/admin";
import { requireRole } from "@/lib/auth/guard";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

/**
 * POST /api/admin/users/[id]/reset-password  (SPEC.md §8.9 / §3.5)
 *
 * メールアドレスを持たない設計のため、パスワードを忘れた人は自分で
 * 復旧できない。admin が仮パスワードを発行し、口頭等で本人に伝える。
 *
 * **仮パスワードはこのレスポンスでしか読めない。** 保存もログもしない
 * (SPEC §13.2「平文ログ禁止」)。伝え損ねたらもう一度発行すればよい。
 */
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof Response) return guard;
  const actor = guard;

  const { id } = await params;
  const admin = createAdminClient();

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("user_id, username")
    .eq("user_id", id)
    .maybeSingle<Pick<Profile, "user_id" | "username">>();

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

  const password = generateTempPassword(Math.max(12, MIN_PASSWORD_LENGTH));

  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    return Response.json(
      { error: `仮パスワードを設定できませんでした: ${error.message}` },
      { status: 500 },
    );
  }

  // detail にパスワードは入れない。誰にいつ発行したかだけを残す
  const warning = await writeAuditLog(admin, {
    actorId: actor.user_id,
    targetUserId: id,
    action: "reset_password",
    detail: { username: target.username },
  });

  return Response.json({
    username: target.username,
    password,
    ...(warning ? { warning } : {}),
  });
}
