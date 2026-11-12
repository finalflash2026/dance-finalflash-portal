import { checkCronSecret } from "@/lib/cron-auth";
import { hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/health  (SPEC.md §8.8 / §13.4)
 *
 * Supabase の無料プロジェクトは1週間無アクセスで一時停止するため、
 * Vercel Cron から1日1回叩いて DB に軽い select を発行し、起こし続ける。
 *
 * 認証は `?secret=` と `Authorization: Bearer` の2通り (lib/cron-auth.ts)。
 * 後者を受け付けているのは、vercel.json の cron path に環境変数を
 * 展開できない (秘密を含む URL を設定ファイルに書けない) ため。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = checkCronSecret(request);
  if (denied) return denied;

  if (!hasSupabaseEnv()) {
    return Response.json(
      { ok: false, error: "Supabase の環境変数が未設定です。" },
      { status: 503 },
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("genres").select("id").limit(1);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
