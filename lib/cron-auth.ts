import "server-only";

import { timingSafeEqual } from "node:crypto";

import { cronSecret } from "@/lib/env";

/**
 * Vercel Cron の呼び出しの確認 (SPEC.md §8.8 / §8.13)
 *
 * 受け付けるのは2通り:
 *   1. `?secret=<CRON_SECRET>`             … 手で叩いて確かめるとき
 *   2. `Authorization: Bearer <CRON_SECRET>` … Vercel Cron が自動で付ける形
 *
 * 秘密が違うときは 404 を返して**エンドポイントの存在自体を隠す** (§13.2)。
 * 呼び出し側は Response が返ってきたらそれをそのまま返すこと。
 */
export function checkCronSecret(request: Request): Response | null {
  const expected = cronSecret();
  if (!expected) {
    return Response.json(
      { ok: false, error: "CRON_SECRET が未設定です。" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const provided =
    url.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!provided || !safeEqual(provided, expected)) {
    return new Response("Not Found", { status: 404 });
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
