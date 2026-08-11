import { timingSafeEqual } from "node:crypto";

import { cronSecret, hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/health  (SPEC.md §8.8 / §13.4)
 *
 * Supabase の無料プロジェクトは1週間無アクセスで一時停止するため、
 * Vercel Cron から1日1回叩いて DB に軽い select を発行し、起こし続ける。
 *
 * 認証は2通りを受け付ける:
 *   1. `?secret=<CRON_SECRET>`            … SPEC §8.8 の記述どおり
 *   2. `Authorization: Bearer <CRON_SECRET>` … Vercel Cron が自動付与する形式
 *
 * 2 を併せて受け付けているのは、vercel.json の cron path に環境変数を
 * 展開できない (秘密を含む URL を設定ファイルに書けない) ため。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request: Request) {
  const expected = cronSecret();
  if (!expected) {
    return Response.json(
      { ok: false, error: "CRON_SECRET が未設定です" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("secret");
  const fromHeader = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const provided = fromQuery ?? fromHeader;

  // 秘密が違うときは 404。エンドポイントの存在自体を隠す (SPEC §13.2)
  if (!provided || !safeEqual(provided, expected)) {
    return new Response("Not Found", { status: 404 });
  }

  if (!hasSupabaseEnv()) {
    return Response.json(
      { ok: false, error: "Supabase の環境変数が未設定です" },
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
