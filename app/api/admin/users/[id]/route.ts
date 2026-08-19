import { z } from "zod";

import { graduateToOb, writeAuditLog } from "@/lib/admin";
import { dummyEmail } from "@/lib/auth/email";
import { requireRole } from "@/lib/auth/guard";
import { buildUsernameFromGenreId } from "@/lib/auth/username";
import { GENRES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile, Role } from "@/lib/types";

/**
 * PATCH /api/admin/users/[id]  (SPEC.md §8.9 / §6.5 / §6.5.1)
 *
 * admin が他ユーザーの `role` / `display_name` / `main_genre_id` / `generation`
 * を変更する。**username は `{期}{1ジャンコード}{名前}` なので自動で再生成する** —
 * 3項目のどれが変わってもログインIDが変わるため、呼び出し側は返ってきた
 * username を本人に必ず伝えること。
 *
 * user_id (UUID) が内部識別子なので、username が変わっても
 * 申請・出欠・ナンバー所属・購読URLはすべて維持される (SPEC §6.5.1)。
 *
 * 認可は requireRole("admin") のみ。profiles の role 変更には RLS ポリシーが
 * 無く (§5.2「insert/delete/role変更はservice role経由のみ」)、
 * ここを通らない限り誰も変更できない。
 */
export const runtime = "nodejs";

const GENRE_IDS: number[] = GENRES.map((g) => g.id);
const ROLES = ["ob", "member", "coordinator", "admin"] as const;

const schema = z
  .object({
    role: z.enum(ROLES).optional(),
    displayName: z
      .string()
      .trim()
      .min(1, "名前を入力してください")
      .max(20, "名前は20文字以内で入力してください")
      .optional(),
    mainGenreId: z
      .number()
      .int()
      .refine((v) => GENRE_IDS.includes(v), "1ジャンを選択してください")
      .optional(),
    generation: z
      .number({ message: "期を数値で入力してください" })
      .int("期は整数で入力してください")
      .min(1, "期が不正です")
      .max(99, "期が不正です")
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "変更する項目がありません",
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const patch = parsed.data;

  const { id } = await params;
  const admin = createAdminClient();

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("*")
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

  // **最後の admin が消えるのを防ぐ** (SPEC §6.5)。
  // 自分以外を降格するのは許す (admin が2人いる前提の運用は admin の責任)。
  if (
    id === actor.user_id &&
    patch.role !== undefined &&
    patch.role !== "admin"
  ) {
    return Response.json(
      { error: "自分自身の管理者権限は外せません。別の管理者に依頼してください" },
      { status: 403 },
    );
  }

  // ---- username の再生成と重複チェック ----
  const nextGeneration = patch.generation ?? target.generation;
  const nextGenreId = patch.mainGenreId ?? target.main_genre_id;
  const nextDisplayName = patch.displayName ?? target.display_name;
  const nextUsername = buildUsernameFromGenreId(
    nextGeneration,
    nextGenreId,
    nextDisplayName,
  );

  if (nextUsername !== target.username) {
    const { data: existing, error: existingError } = await admin
      .from("profiles")
      .select("user_id")
      .eq("username", nextUsername)
      .maybeSingle();

    if (existingError) {
      return Response.json(
        { error: `DBに接続できませんでした: ${existingError.message}` },
        { status: 503 },
      );
    }
    if (existing) {
      return Response.json(
        {
          error: `ユーザーID「${nextUsername}」は既に使われています。名前の表記を変えてください`,
        },
        { status: 409 },
      );
    }
  }

  // ---- OB化は先に。未来の申請・出欠とサブジャンルの削除を伴う (SPEC §3.6) ----
  const graduating = patch.role === "ob" && target.role !== "ob";
  if (graduating) {
    const result = await graduateToOb(admin, [id]);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 500 });
    }
  }

  // ---- profiles を更新 ----
  // role は OB化のとき DB 関数側で更新済みなので、ここでは触らない
  const update: Record<string, unknown> = { username: nextUsername };
  if (patch.displayName !== undefined) update.display_name = nextDisplayName;
  if (patch.mainGenreId !== undefined) update.main_genre_id = nextGenreId;
  if (patch.generation !== undefined) update.generation = nextGeneration;
  if (patch.role !== undefined && !graduating) update.role = patch.role;

  const { error: updateError } = await admin
    .from("profiles")
    .update(update)
    .eq("user_id", id);

  if (updateError) {
    // 重複チェックをすり抜けた同時実行 (23505) はここで拾う
    const status = updateError.code === "23505" ? 409 : 500;
    return Response.json(
      {
        error:
          status === 409
            ? `ユーザーID「${nextUsername}」は既に使われています。名前の表記を変えてください`
            : `更新に失敗しました: ${updateError.message}`,
      },
      { status },
    );
  }

  // ---- auth 側のダミーメールも username に追従させる ----
  // ログインは username からダミーメールを**再合成**して行うため (§3.3)、
  // ここを更新し忘れると「IDを変えた瞬間に本人がログインできない」。
  // profiles を戻せる位置で行い、失敗したら username を元に戻す
  // (username だけ新しくメールが古い状態が、いちばん復旧しづらい)。
  if (nextUsername !== target.username) {
    const { error: authError } = await admin.auth.admin.updateUserById(id, {
      email: dummyEmail(nextUsername),
      email_confirm: true,
    });

    if (authError) {
      // username は3項目から組み立てるものなので、まとめて戻さないと
      // 「IDだけ旧姓で中身は新しい」不整合が残る。role は戻さない
      // (OB化の削除処理は取り消せないため、ここで現役に戻すほうが害が大きい)
      await admin
        .from("profiles")
        .update({
          username: target.username,
          display_name: target.display_name,
          generation: target.generation,
          main_genre_id: target.main_genre_id,
        })
        .eq("user_id", id);
      return Response.json(
        {
          error: `ログインIDの変更に失敗しました (変更前の状態に戻しました): ${authError.message}`,
        },
        { status: 500 },
      );
    }
  }

  // ---- 新しい1ジャンと同じサブジャンルは重複するので消す (SPEC §6.5.1) ----
  // OB化した場合はサブジャンルごと消えているので不要
  if (patch.mainGenreId !== undefined && !graduating) {
    const { error: subgenreError } = await admin
      .from("user_subgenres")
      .delete()
      .eq("user_id", id)
      .eq("genre_id", nextGenreId);

    if (subgenreError) {
      return Response.json(
        {
          error: `1ジャンと重複するサブジャンルを削除できませんでした: ${subgenreError.message}`,
        },
        { status: 500 },
      );
    }
  }

  const nextRole: Role = patch.role ?? target.role;
  const warning = await writeAuditLog(admin, {
    actorId: actor.user_id,
    targetUserId: id,
    action: graduating
      ? "graduate_ob"
      : target.role === "ob" && nextRole !== "ob"
        ? "restore_member"
        : "update_profile",
    detail: {
      before: {
        username: target.username,
        generation: target.generation,
        main_genre_id: target.main_genre_id,
        display_name: target.display_name,
        role: target.role,
      },
      after: {
        username: nextUsername,
        generation: nextGeneration,
        main_genre_id: nextGenreId,
        display_name: nextDisplayName,
        role: nextRole,
      },
    },
  });

  return Response.json({
    username: nextUsername,
    role: nextRole,
    generation: nextGeneration,
    mainGenreId: nextGenreId,
    displayName: nextDisplayName,
    ...(warning ? { warning } : {}),
  });
}
