import "server-only";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { generateCalendarToken } from "@/lib/auth/token";
import { buildUsernameFromGenreId } from "@/lib/auth/username";
import { GENRES } from "@/lib/constants";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * 登録の共通部分 (SPEC.md §3.2 / §3.7)。
 *
 * ユーザーIDとパスワードでの登録 (`/api/auth/signup`) と、Google でログインした
 * あとの登録 (`/api/auth/complete-profile`) で、**合言葉の照合・ユーザーIDの
 * 組み立て・プロフィールの作り方を1か所にまとめる** (条件を2か所に持たない)。
 */

type Admin = ReturnType<typeof createAdminClient>;

const GENRE_IDS: number[] = GENRES.map((g) => g.id);

/** 期・1ジャン・名前・2/3ジャン・合言葉。パスワードは含めない */
export const memberFieldsSchema = z
  .object({
    generation: z
      .number({ message: "期を数値で入力してください" })
      .int("期は整数で入力してください")
      .min(1, "期が正しくありません")
      .max(99, "期が正しくありません"),
    mainGenreId: z
      .number()
      .int()
      .refine((v) => GENRE_IDS.includes(v), "1ジャンを選んでください"),
    displayName: z
      .string()
      .trim()
      .min(1, "名前を入力してください")
      .max(20, "名前は20文字以内で入力してください"),
    passphrase: z.string().min(1, "サークル生合言葉を入力してください"),
    /** 2ジャン・3ジャン (v1.19)。未設定は null */
    subgenre2Id: z.number().int().nullable().optional(),
    subgenre3Id: z.number().int().nullable().optional(),
  })
  .refine(
    (v) => [v.subgenre2Id, v.subgenre3Id].every((id) => id == null || GENRE_IDS.includes(id)),
    { message: "選べないジャンルが指定されています", path: ["subgenre2Id"] },
  )
  .refine(
    (v) => [v.subgenre2Id, v.subgenre3Id].every((id) => id == null || id !== v.mainGenreId),
    { message: "1ジャンと同じジャンルは選べません", path: ["subgenre2Id"] },
  )
  .refine(
    (v) => v.subgenre2Id == null || v.subgenre3Id == null || v.subgenre2Id !== v.subgenre3Id,
    { message: "2ジャンと3ジャンに同じジャンルは選べません", path: ["subgenre3Id"] },
  );

export type MemberFields = z.infer<typeof memberFieldsSchema>;

/** 失敗は画面に出す文と HTTP の状態で返す */
export type RegisterResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/** サークル生合言葉を照合する */
export async function verifySignupPassphrase(
  admin: Admin,
  passphrase: string,
): Promise<RegisterResult<null>> {
  const { data: setting, error } = await admin
    .from("app_settings")
    .select("value_hash")
    .eq("key", "signup_pass")
    .maybeSingle();

  // 接続エラーと「行が無い」を混同しないこと。
  // 混同すると設定ミス(URLの誤りなど)が「合言葉が未設定」に見えて原因を追えなくなる
  if (error) {
    return { ok: false, error: `DBに接続できませんでした: ${error.message}`, status: 503 };
  }
  if (!setting) {
    return { ok: false, error: "合言葉が未設定です。管理者に連絡してください。", status: 503 };
  }
  if (!(await bcrypt.compare(passphrase, setting.value_hash))) {
    return { ok: false, error: "合言葉が違います。", status: 403 };
  }
  return { ok: true, value: null };
}

/** ユーザーIDを組み立て、使われていないことを確かめる */
export async function reserveUsername(
  admin: Admin,
  fields: Pick<MemberFields, "generation" | "mainGenreId" | "displayName">,
): Promise<RegisterResult<string>> {
  const username = buildUsernameFromGenreId(
    fields.generation,
    fields.mainGenreId,
    fields.displayName,
  );
  const { data: existing, error } = await admin
    .from("profiles")
    .select("user_id")
    .eq("username", username)
    .maybeSingle();

  // ここでエラーを握り潰すと「重複なし」と誤判定してしまう
  if (error) {
    return { ok: false, error: `DBに接続できませんでした: ${error.message}`, status: 503 };
  }
  if (existing) {
    return {
      ok: false,
      error: `ユーザーID「${username}」は既に使われています。名前の表記を変えてください。`,
      status: 409,
    };
  }
  return { ok: true, value: username };
}

/**
 * profiles・user_subgenres・calendar_tokens を作る。
 * 途中で失敗したら、ここで作った行を消して戻す (auth ユーザーの扱いは呼び出し側)
 */
export async function createMemberRecords(
  admin: Admin,
  userId: string,
  username: string,
  fields: MemberFields,
): Promise<RegisterResult<null>> {
  const { error: profileError } = await admin.from("profiles").insert({
    user_id: userId,
    username,
    generation: fields.generation,
    main_genre_id: fields.mainGenreId,
    display_name: fields.displayName,
  });
  if (profileError) {
    return { ok: false, error: `登録に失敗しました: ${profileError.message}`, status: 500 };
  }

  // 2ジャン・3ジャン (v1.19)。選ばなければ行を作らない = 未設定
  const subgenreRows = (
    [
      [2, fields.subgenre2Id],
      [3, fields.subgenre3Id],
    ] as const
  )
    .filter(([, genreId]) => genreId != null)
    .map(([slot, genreId]) => ({ user_id: userId, slot, genre_id: genreId as number }));

  // profiles を消せば user_subgenres・calendar_tokens も cascade で消える
  const rollback = () => admin.from("profiles").delete().eq("user_id", userId);

  if (subgenreRows.length > 0) {
    const { error } = await admin.from("user_subgenres").insert(subgenreRows);
    if (error) {
      await rollback();
      return { ok: false, error: `登録に失敗しました: ${error.message}`, status: 500 };
    }
  }

  const { error: tokenError } = await admin
    .from("calendar_tokens")
    .insert({ user_id: userId, token: generateCalendarToken() });
  if (tokenError) {
    await rollback();
    return { ok: false, error: `登録に失敗しました: ${tokenError.message}`, status: 500 };
  }
  return { ok: true, value: null };
}
