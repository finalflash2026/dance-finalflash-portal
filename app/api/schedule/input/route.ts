import { requireRole } from "@/lib/auth/guard";
import { getRoundForMonth, loadMonthInput } from "@/lib/scheduling/live";
import type { DateString } from "@/lib/types";

/**
 * GET /api/schedule/input?month=YYYY-MM-01  (SPEC.md §6.8.5 / v1.44)
 *
 * その月の日程調整の回・候補 (予約枠から)・現役・全員の回答。**折衝・3役だけ**。
 * 折衝の画面の「日程調整」の欄が、開くたびに読み直す (取り込み直した後も新しい候補で)。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}-01$/.test(month)) {
    return Response.json({ error: "月が正しくありません。" }, { status: 400 });
  }
  const round = await getRoundForMonth(month as DateString, guard.user_id);
  const input = await loadMonthInput(month as DateString, round?.id ?? null);
  return Response.json({ round, input }, { headers: { "cache-control": "no-store" } });
}
