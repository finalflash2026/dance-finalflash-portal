import bcrypt from "bcryptjs";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin";
import { requireRole } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/admin/passphrases  (SPEC.md §8.9 / §3.5 / §6.5)
 *
 * 合言葉3種 (サークル生 / 折衝 / 管理者) を bcrypt ハッシュにして
 * `app_settings` に upsert する。**代替わり・卒業時に必ず変更する**運用。
 *
 * 空欄の項目は触らない。1つだけ変えたい場面のほうが多いため。
 * 監査ログには**どのキーを変えたかだけ**を残す (値は平文ログ禁止。SPEC §13.2)。
 */
export const runtime = "nodejs";

const BCRYPT_ROUNDS = 10;
/** 150人で共有するものなので長さより「変え忘れないこと」が要点。下限だけ置く */
const MIN_LENGTH = 6;

const passphrase = z
  .string()
  .min(MIN_LENGTH, `合言葉は${MIN_LENGTH}文字以上にしてください`)
  .optional();

const schema = z
  .object({
    signupPass: passphrase,
    coordinatorPass: passphrase,
    adminPass: passphrase,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "変更する合言葉を入力してください",
  });

const KEYS = [
  { field: "signupPass", key: "signup_pass", label: "サークル生合言葉" },
  { field: "coordinatorPass", key: "coordinator_pass", label: "折衝パスワード" },
  { field: "adminPass", key: "admin_pass", label: "管理者パスワード" },
] as const;

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

  const updates: { key: string; value_hash: string; updated_at: string }[] = [];
  const labels: string[] = [];
  const now = new Date().toISOString();

  for (const entry of KEYS) {
    const value = parsed.data[entry.field];
    if (value === undefined) continue;
    updates.push({
      key: entry.key,
      value_hash: await bcrypt.hash(value, BCRYPT_ROUNDS),
      // 既定値は insert 時にしか効かないので、更新時は明示的に入れる
      updated_at: now,
    });
    labels.push(entry.label);
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert(updates, { onConflict: "key" });

  if (error) {
    return Response.json(
      { error: `合言葉を更新できませんでした: ${error.message}` },
      { status: 500 },
    );
  }

  const warning = await writeAuditLog(admin, {
    actorId: actor.user_id,
    targetUserId: null,
    action: "update_passphrase",
    detail: { keys: updates.map((u) => u.key) },
  });

  return Response.json({
    updated: labels,
    ...(warning ? { warning } : {}),
  });
}
