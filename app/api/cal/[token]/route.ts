import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents } from "@/lib/events";
import { buildCalendar } from "@/lib/ics";
import { createAdminClient } from "@/lib/supabase/admin";
import { addMonths, endOfMonth, startOfMonth, todayInTokyo } from "@/lib/time";
import type { Profile } from "@/lib/types";

/**
 * GET /api/cal/[token]  (SPEC.md §8.6 / §10)
 *
 * Google / Apple カレンダーが定期取得する購読エンドポイント。
 * **認証不要**(トークン自体が鍵)なので middleware の matcher からも除外している。
 *
 *   1) service role で calendar_tokens からユーザーを特定 (不一致 → 404)
 *   2) §6.4 の抽出ロジック (getMyEvents) で 当月-1ヶ月 〜 +3ヶ月 を収集
 *   3) ics を返す
 *
 * service role は RLS をバイパスするため、**getMyEvents が条件をすべて
 * クエリに明示していること**が他人の予定混入を防ぐ唯一の砦になる (SPEC §13.2)。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!hasSupabaseEnv()) {
    return new Response("Not Found", { status: 404 });
  }

  const { token } = await params;
  const admin = createAdminClient();

  const { data: tokenRow, error: tokenError } = await admin
    .from("calendar_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();

  // DB エラーを 404 に丸めると、設定ミスとトークン誤りの区別がつかなくなる
  if (tokenError) {
    return new Response(`DB error: ${tokenError.message}`, { status: 503 });
  }
  // 存在しないトークンは 404。403 にすると総当たりの手がかりを与えるため
  if (!tokenRow) {
    return new Response("Not Found", { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("user_id", tokenRow.user_id)
    .maybeSingle();

  if (!profile) {
    return new Response("Not Found", { status: 404 });
  }

  const today = todayInTokyo();
  const from = startOfMonth(addMonths(today, -1));
  const to = endOfMonth(addMonths(today, 3));

  const events = await getMyEvents(admin, profile as Profile, from, to);
  const ics = buildCalendar(events, (profile as Profile).username);

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": 'inline; filename="dance.ics"',
    },
  });
}
