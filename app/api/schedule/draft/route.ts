import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/schedule/draft  (SPEC.md §6.8.4 / v1.36)
 *
 * 日程調整の案を、その月のコマ割りの下書きに入れる。公開していないコマを消してから
 * 案のコマを作る (DB の関数 replace_draft_slots。1回で行う)。折衝・3役だけ。
 * 公開済みのコマがある月では作らない (上書きで空き申請が消えるのを防ぐ)。
 */
export const runtime = "nodejs";

const time = z.string().regex(/^\d{2}:\d{2}$/);
const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  slots: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        roomId: z.number().int(),
        startTime: time,
        endTime: time,
        genreId: z.number().int(),
      }),
    )
    .max(2000),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "案の形が正しくありません。" }, { status: 400 });
  }
  // 手元の環境 (Supabase 未設定) は見本なので、作ったことにして返す
  if (!hasSupabaseEnv()) {
    return Response.json({ created: parsed.data.slots.length });
  }
  const guard = await requireRole("coordinator");
  if (guard instanceof Response) return guard;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("replace_draft_slots", {
    p_month: parsed.data.month,
    p_slots: parsed.data.slots.map((s) => ({
      date: s.date,
      room_id: s.roomId,
      start_time: s.startTime,
      end_time: s.endTime,
      genre_id: s.genreId,
    })),
  });
  if (error) {
    const published = error.message.includes("published");
    return Response.json(
      {
        error: published
          ? "この月には公開済みのコマがあるので、下書きを作れません。"
          : `下書きを作れませんでした: ${error.message}`,
      },
      { status: published ? 409 : 500 },
    );
  }
  return Response.json({ created: data as number });
}
