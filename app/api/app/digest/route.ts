import { demoCalendar } from "@/app/(app)/demo/data";
import { DIGEST_DAYS, buildAppDigest } from "@/lib/app-digest";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents } from "@/lib/events";
import { IMPORTANT_DEADLINE_LEAD_DAYS } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { addDays, nowTimeInTokyo, todayInTokyo } from "@/lib/time";

/**
 * GET /api/app/digest  (SPEC.md §2.3.1 / v1.38)
 *
 * iOS アプリが開くたびに取りにくる「これからの予定」。アプリはこれで
 * 端末に通知を予約し、ウィジェットに出す。**自分の予定だけ**
 * (getMyEvents。§6.4 と同じ絞り込み) で、ログインした本人の RLS で引く。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const today = todayInTokyo();
  const now = `${today}T${nowTimeInTokyo()}`;

  // Supabase 未設定の手元の環境はデモの予定 (シミュレーターで確かめるため)
  if (!hasSupabaseEnv()) {
    return Response.json(buildAppDigest(demoCalendar(false).events, today, now));
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "ログインしてください" }, { status: 401 });
  }

  const supabase = await createClient();
  // 前日 … 日をまたぐ深夜練 / 先の7日 … 「1週間後に締切」
  const events = await getMyEvents(
    supabase,
    profile,
    addDays(today, -1),
    addDays(today, DIGEST_DAYS - 1 + IMPORTANT_DEADLINE_LEAD_DAYS),
  );
  return Response.json(buildAppDigest(events, today, now), {
    headers: { "cache-control": "no-store" },
  });
}
