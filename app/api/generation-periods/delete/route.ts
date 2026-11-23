import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { hasSupabaseEnv } from "@/lib/env";
import {
  periodErrorResponse,
  respondWithPush,
  type PeriodRpcResult,
} from "@/lib/generation-periods-server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/generation-periods/delete  (SPEC.md §8.14 / v1.51)
 *
 * 公式練の対象期の期間を1つ消す。消した日はどの期間にも入らなくなり、全期に戻る。
 * 扱いは保存と同じ (公開済みの練習が変わるなら3役だけ。出欠の削除・お知らせは DB の関数の中)。
 * 削除を専用のパスに分けるのは §8.9 と同じ理由。
 */
export const runtime = "nodejs";

const schema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "期間の指定が正しくありません。" }, { status: 400 });
  }
  if (!hasSupabaseEnv()) {
    return Response.json({ id: parsed.data.id, changed: 0, removed: 0, notified: 0 });
  }
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_generation_period", {
    p_id: parsed.data.id,
    p_updated_at: parsed.data.updatedAt,
  });
  if (error) return periodErrorResponse(error, "削除");
  return respondWithPush(data as PeriodRpcResult);
}
