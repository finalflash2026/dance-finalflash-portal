import bcrypt from "bcryptjs";
import { z } from "zod";

import { dummyEmail } from "@/lib/auth/email";
import { generateCalendarToken } from "@/lib/auth/token";
import { buildUsernameFromGenreId } from "@/lib/auth/username";
import { GENRES, MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/auth/signup  (SPEC.md §8.1 / §3.2)
 *
 * Supabase の一般サインアップは無効化してあるので、登録は必ずここを通る。
 * これにより合言葉の検証を強制できる。
 *
 * 1) app_settings.signup_pass と bcrypt 照合 (不一致 → 403)
 * 2) username 組立 → 重複チェック (409)
 * 3) auth.admin.createUser (ダミーメール, email_confirm: true)
 * 4) profiles insert
 * 5) calendar_tokens insert (32byte base64url)
 *
 * 3 以降で失敗したら作成済みの auth ユーザーを削除してロールバックする
 * (auth.users だけ残ると同じ username で二度と登録できなくなるため)。
 */
export const runtime = "nodejs";

const GENRE_IDS: number[] = GENRES.map((g) => g.id);

const schema = z.object({
  generation: z
    .number({ message: "期を数値で入力してください" })
    .int("期は整数で入力してください")
    .min(1, "期が不正です")
    .max(99, "期が不正です"),
  mainGenreId: z
    .number()
    .int()
    .refine((v) => GENRE_IDS.includes(v), "1ジャンを選択してください"),
  displayName: z
    .string()
    .trim()
    .min(1, "名前を入力してください")
    .max(20, "名前は20文字以内で入力してください"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`),
  passphrase: z.string().min(1, "サークル生合言葉を入力してください"),
});

export async function POST(request: Request) {
  if (!checkRateLimit(`signup:${clientIp(request)}`)) {
    return Response.json(
      { error: "試行回数が多すぎます。1分ほど待ってからやり直してください" },
      { status: 429 },
    );
  }

  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です (Supabase 未接続)" },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容が不正です" },
      { status: 400 },
    );
  }
  const { generation, mainGenreId, displayName, password, passphrase } =
    parsed.data;

  const admin = createAdminClient();

  // ---- 1. 合言葉の照合 ----
  const { data: setting, error: settingError } = await admin
    .from("app_settings")
    .select("value_hash")
    .eq("key", "signup_pass")
    .maybeSingle();

  // 接続エラーと「行が無い」を混同しないこと。
  // 混同すると設定ミス(URLの誤りなど)が「合言葉が未設定」に見えて原因を追えなくなる
  if (settingError) {
    return Response.json(
      { error: `DBに接続できませんでした: ${settingError.message}` },
      { status: 503 },
    );
  }
  if (!setting) {
    return Response.json(
      { error: "合言葉が未設定です。管理者に連絡してください" },
      { status: 503 },
    );
  }
  if (!(await bcrypt.compare(passphrase, setting.value_hash))) {
    return Response.json({ error: "合言葉が違います" }, { status: 403 });
  }

  // ---- 2. username 組立と重複チェック ----
  const username = buildUsernameFromGenreId(
    generation,
    mainGenreId,
    displayName,
  );

  const { data: existing, error: existingError } = await admin
    .from("profiles")
    .select("user_id")
    .eq("username", username)
    .maybeSingle();

  // ここでエラーを握り潰すと「重複なし」と誤判定して auth ユーザーを作ってしまう
  if (existingError) {
    return Response.json(
      { error: `DBに接続できませんでした: ${existingError.message}` },
      { status: 503 },
    );
  }
  if (existing) {
    return Response.json(
      {
        error: `ユーザーID「${username}」は既に使われています。名前の表記を変えてください`,
      },
      { status: 409 },
    );
  }

  // ---- 3. auth ユーザー作成 ----
  const { data: created, error: createError } = await admin.auth.admin.createUser(
    {
      email: dummyEmail(username),
      password,
      email_confirm: true,
    },
  );

  if (createError || !created.user) {
    return Response.json(
      { error: `登録に失敗しました: ${createError?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const userId = created.user.id;

  // ---- 4-5. profiles / calendar_tokens。失敗したら auth ユーザーを消して戻す ----
  const { error: profileError } = await admin.from("profiles").insert({
    user_id: userId,
    username,
    generation,
    main_genre_id: mainGenreId,
    display_name: displayName,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return Response.json(
      { error: `登録に失敗しました: ${profileError.message}` },
      { status: 500 },
    );
  }

  const { error: tokenError } = await admin.from("calendar_tokens").insert({
    user_id: userId,
    token: generateCalendarToken(),
  });

  if (tokenError) {
    // profiles は user_id に on delete cascade が付いているので一緒に消える
    await admin.auth.admin.deleteUser(userId);
    return Response.json(
      { error: `登録に失敗しました: ${tokenError.message}` },
      { status: 500 },
    );
  }

  return Response.json({ username }, { status: 201 });
}
