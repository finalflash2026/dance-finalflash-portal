import { z } from "zod";

import { dummyEmail } from "@/lib/auth/email";
import {
  createMemberRecords,
  memberFieldsSchema,
  reserveUsername,
  verifySignupPassphrase,
} from "@/lib/auth/register";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { clientIp, hitRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/auth/signup  (SPEC.md §8.1 / §3.2)
 *
 * ユーザーIDとパスワードでの登録。Google での登録は /api/auth/complete-profile (§3.7)。
 * 合言葉の照合・ユーザーIDの組み立て・プロフィールの作成は lib/auth/register.ts と共通。
 *
 * 1) app_settings.signup_pass と bcrypt 照合 (不一致 → 403)
 * 2) username 組立 → 重複チェック (409)
 * 3) auth.admin.createUser (ダミーメール, email_confirm: true)
 * 4) profiles / user_subgenres / calendar_tokens
 *
 * 4 で失敗したら作成済みの auth ユーザーを削除してロールバックする
 * (auth.users だけ残ると同じ username で二度と登録できなくなるため)。
 */
export const runtime = "nodejs";

const schema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`),
    /**
     * 確認用のもう一度の入力 (v1.19)。
     * 画面側でも突き合わせるが、**API は直接叩けるのでここでも見る**。
     */
    passwordConfirm: z.string().min(1, "確認用のパスワードを入力してください"),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: "パスワードが一致しません",
    path: ["passwordConfirm"],
  });

export async function POST(request: Request) {
  // 試行回数の制限は DB で数える (§13.2 / v1.31.4)。IP ごと 5回/分
  if (!(await hitRateLimit(`signup:ip:${clientIp(request)}`, 5, 60_000))) {
    return Response.json(
      { error: "試行回数が多すぎます。1分ほど待ってからやり直してください。" },
      { status: 429 },
    );
  }

  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です(Supabase 未接続)。" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const fields = memberFieldsSchema.safeParse(body);
  const passwords = schema.safeParse(body);
  if (!fields.success || !passwords.success) {
    const issue = (fields.error ?? passwords.error)?.issues[0];
    return Response.json({ error: issue?.message ?? "入力内容が正しくありません。" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ---- 1. 合言葉の照合 ----
  const pass = await verifySignupPassphrase(admin, fields.data.passphrase);
  if (!pass.ok) return Response.json({ error: pass.error }, { status: pass.status });

  // ---- 2. username 組立と重複チェック ----
  const reserved = await reserveUsername(admin, fields.data);
  if (!reserved.ok) return Response.json({ error: reserved.error }, { status: reserved.status });
  const username = reserved.value;

  // ---- 3. auth ユーザー作成 ----
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: dummyEmail(username),
    password: passwords.data.password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return Response.json(
      { error: `登録に失敗しました: ${createError?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // ---- 4. プロフィールなど。失敗したら auth ユーザーを消して戻す ----
  const records = await createMemberRecords(admin, created.user.id, username, fields.data);
  if (!records.ok) {
    await admin.auth.admin.deleteUser(created.user.id);
    return Response.json({ error: records.error }, { status: records.status });
  }

  return Response.json({ username }, { status: 201 });
}
