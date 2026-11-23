import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { hasSupabaseEnv } from "@/lib/env";
import { PERIOD_NAME_MAX } from "@/lib/generation-periods";
import {
  periodErrorResponse,
  respondWithPush,
  type PeriodRpcResult,
} from "@/lib/generation-periods-server";
import { createClient } from "@/lib/supabase/server";
import { isValidDateString } from "@/lib/time";

/**
 * POST /api/generation-periods  (SPEC.md §8.14 / §6.2 Step3 / v1.51)
 *
 * 公式練の対象期の期間を1つ保存する。coordinator 以上。
 *
 * **セッションのクライアントで DB の関数を呼ぶ。** 権限、「公開済みの練習が変わるか」
 * (変わるなら3役だけ)、重なる期間の片付け、出欠の削除、お知らせは関数の中で
 * 1回の取引として行う (§5.2)。ここで足すのは端末の通知だけ。
 */
export const runtime = "nodejs";

const date = z.string().refine(isValidDateString);
const schema = z.object({
  /** 新しく作るときは送らない */
  id: z.string().uuid().nullable().optional(),
  /** 編集では読んだときの値 (ほかの人が先に変えていたら止めるため) */
  updatedAt: z.string().min(1).nullable().optional(),
  name: z.string().max(PERIOD_NAME_MAX).optional(),
  startDate: date,
  endDate: date,
  /** 空なら全期 */
  generations: z.array(z.number().int().min(1).max(999)).max(50),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (
    !parsed.success ||
    parsed.data.endDate < parsed.data.startDate ||
    (parsed.data.id && !parsed.data.updatedAt)
  ) {
    return Response.json({ error: "期間の形が正しくありません。" }, { status: 400 });
  }
  // 手元の環境 (Supabase 未設定) は見本なので、保存したことにして返す
  if (!hasSupabaseEnv()) {
    return Response.json({ id: parsed.data.id ?? "demo", changed: 0, removed: 0, notified: 0 });
  }
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const { id, updatedAt, name, startDate, endDate, generations } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_generation_period", {
    p_id: id ?? null,
    p_updated_at: id ? updatedAt : null,
    p_name: name?.trim() || null,
    p_start: startDate,
    p_end: endDate,
    p_generations: generations,
  });
  if (error) return periodErrorResponse(error, "保存");
  return respondWithPush(data as PeriodRpcResult);
}
