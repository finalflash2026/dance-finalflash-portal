import { demoCalendar } from "@/app/(app)/demo/data";
import { DIGEST_DAYS, buildAppDigest } from "@/lib/app-digest";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents } from "@/lib/events";
import { IMPORTANT_DEADLINE_LEAD_DAYS } from "@/lib/reminders";
import { getOpenRound } from "@/lib/scheduling/live";
import { liveDemoRound, roundTitle } from "@/lib/scheduling/round";
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
    const round = liveDemoRound(today);
    return Response.json(
      buildAppDigest(demoCalendar(false).events, today, now, {
        round: { title: roundTitle(round), deadline: round.deadline },
        keys: { unlocked: 1, holder: "22BREAKたろう" },
      }),
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "ログインしてください" }, { status: 401 });
  }

  const supabase = await createClient();
  const isOb = profile.role === "ob";
  const none = Promise.resolve({ data: [] as unknown[] });
  const [events, roomStatus, keyHolder] = await Promise.all([
    // 前日 … 日をまたぐ深夜練 / 先の7日 … 「1週間後に締切」
    getMyEvents(
      supabase,
      profile,
      addDays(today, -1),
      addDays(today, DIGEST_DAYS - 1 + IMPORTANT_DEADLINE_LEAD_DAYS),
    ),
    // 鍵の要約 (ホームの入口と同じ。OB には出さない)
    isOb ? none : supabase.from("room_status").select("is_unlocked").eq("date", today),
    isOb
      ? none
      : supabase
          .from("club_key_holders")
          .select("profiles(username)")
          .order("taken_at", { ascending: false })
          .limit(1),
  ]);

  // 日程調整の回はホームのカードと同じもの (§6.8.4)
  const round = isOb ? null : await getOpenRound(today, profile.user_id);
  const keys = isOb
    ? null
    : {
        unlocked: ((roomStatus.data ?? []) as { is_unlocked: boolean }[]).filter((r) => r.is_unlocked)
          .length,
        holder:
          ((keyHolder.data ?? []) as unknown as { profiles: { username: string } | null }[])[0]
            ?.profiles?.username ?? null,
      };

  return Response.json(
    buildAppDigest(events, today, now, {
      round: round && round.status === "open" ? { title: roundTitle(round), deadline: round.deadline } : null,
      keys,
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
