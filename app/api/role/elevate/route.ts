import bcrypt from "bcryptjs";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/types";

/**
 * POST /api/role/elevate  (SPEC.md §8.3 / §3.4)
 *
 * ログイン済みユーザーが「折衝パスワード」or「管理者パスワード」を送ると、
 * bcrypt 照合のうえ service role で profiles.role を更新する。
 *
 * ルール:
 *   - coordinator_pass → admin_pass の順に照合する
 *   - **現ロールより下位への変更はしない** (admin が折衝パスワードを入れても降格しない)
 *   - **role='ob' は合言葉が正しくても 403**。OB は昇格できない (§3.6)
 */
export const runtime = "nodejs";

const schema = z.object({
  rolePassword: z.string().min(1, "パスワードを入力してください"),
});

/** 包含関係の順位。ob は現役の外側なのでここには含めない (SPEC §3.1) */
const RANK: Record<Exclude<Role, "ob">, number> = {
  member: 1,
  coordinator: 2,
  admin: 3,
};

const CANDIDATES = [
  { key: "coordinator_pass", role: "coordinator" as const },
  { key: "admin_pass", role: "admin" as const },
];

export async function POST(request: Request) {
  if (!checkRateLimit(`elevate:${clientIp(request)}`)) {
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

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "ログインしてください" }, { status: 401 });
  }

  // OB は昇格不可 (SPEC §3.6)
  if (profile.role === "ob") {
    return Response.json(
      { error: "OB/OGは折衝・管理者になれません" },
      { status: 403 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容が不正です" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: settings, error: settingsError } = await admin
    .from("app_settings")
    .select("key, value_hash")
    .in(
      "key",
      CANDIDATES.map((c) => c.key),
    );

  // 接続エラーを「合言葉が違います」に見せないこと (原因が追えなくなる)
  if (settingsError) {
    return Response.json(
      { error: `DBに接続できませんでした: ${settingsError.message}` },
      { status: 503 },
    );
  }

  const hashByKey = new Map(
    ((settings ?? []) as { key: string; value_hash: string }[]).map((s) => [
      s.key,
      s.value_hash,
    ]),
  );

  let matched: Exclude<Role, "ob"> | null = null;
  for (const candidate of CANDIDATES) {
    const hash = hashByKey.get(candidate.key);
    if (hash && (await bcrypt.compare(parsed.data.rolePassword, hash))) {
      matched = candidate.role;
      break;
    }
  }

  if (!matched) {
    return Response.json({ error: "合言葉が違います" }, { status: 403 });
  }

  // 現ロールより下位への変更はしない
  const current = profile.role as Exclude<Role, "ob">;
  if (RANK[matched] <= RANK[current]) {
    return Response.json({
      role: current,
      message: `既に${ROLE_LABELS[current]}です`,
    });
  }

  const { error } = await admin
    .from("profiles")
    .update({ role: matched })
    .eq("user_id", profile.user_id);

  if (error) {
    return Response.json(
      { error: `更新に失敗しました: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.json({
    role: matched,
    message: `${ROLE_LABELS[matched]}になりました`,
  });
}
