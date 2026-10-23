import {
  createMemberRecords,
  memberFieldsSchema,
  reserveUsername,
  verifySignupPassphrase,
} from "@/lib/auth/register";
import { hasSupabaseEnv } from "@/lib/env";
import { clientIp, hitRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/complete-profile  (SPEC.md §3.7 / v1.34)
 *
 * Google でログインした人が、期・1ジャン・名前・2/3ジャン・サークル生合言葉を入れて
 * 登録を終える。auth ユーザーは Google のログインで既にできているので、ここでは
 * プロフィールなどだけを作る。合言葉の照合とユーザーIDの扱いは /api/auth/signup と共通。
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const parsed = memberFieldsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容が正しくありません。" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // 既に登録を終えている人は作り直さない (二重送信・別のタブ)
  const { data: existing } = await admin
    .from("profiles")
    .select("username")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return Response.json({ username: existing.username }, { status: 200 });

  const pass = await verifySignupPassphrase(admin, parsed.data.passphrase);
  if (!pass.ok) return Response.json({ error: pass.error }, { status: pass.status });

  const reserved = await reserveUsername(admin, parsed.data);
  if (!reserved.ok) return Response.json({ error: reserved.error }, { status: reserved.status });

  const records = await createMemberRecords(admin, user.id, reserved.value, parsed.data);
  if (!records.ok) return Response.json({ error: records.error }, { status: records.status });

  return Response.json({ username: reserved.value }, { status: 201 });
}
