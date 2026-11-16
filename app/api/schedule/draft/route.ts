import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { hasSupabaseEnv } from "@/lib/env";
import { isMissingRelation } from "@/lib/schema-errors";
import { createClient } from "@/lib/supabase/server";
import { addMonths } from "@/lib/time";
import type { DateString } from "@/lib/types";

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
  // 0027 を流していない DB では関数が無い (v1.49)。同じ手順を順に行う
  if (isMissingRelation(error)) {
    return replaceDraftSlotsStepByStep(supabase, parsed.data.month, parsed.data.slots);
  }
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

/**
 * replace_draft_slots (0027) と同じことを、DB の関数を使わずに順に行う (v1.49)。
 * 1回の取引にはならないので、新しい下書きを先に作り、成功してから前の下書きを消す (v1.50.2)。
 */
async function replaceDraftSlotsStepByStep(
  supabase: Awaited<ReturnType<typeof createClient>>,
  month: string,
  slots: z.infer<typeof schema>["slots"],
): Promise<Response> {
  const end = addMonths(month as DateString, 1);
  const { count: publishedCount, error: publishedError } = await supabase
    .from("slots")
    .select("id", { count: "exact", head: true })
    .gte("date", month)
    .lt("date", end)
    .eq("published", true);
  if (publishedError) {
    return Response.json({ error: `下書きを作れませんでした: ${publishedError.message}` }, { status: 500 });
  }
  if ((publishedCount ?? 0) > 0) {
    return Response.json(
      { error: "この月には公開済みのコマがあるので、下書きを作れません。" },
      { status: 409 },
    );
  }

  const { data: reservations, error: reservationError } = await supabase
    .from("reservations")
    .select("id, date, room_id, start_time, end_time")
    .eq("status", "active")
    .gte("date", month)
    .lt("date", end)
    .order("start_time");
  if (reservationError) {
    return Response.json({ error: `下書きを作れませんでした: ${reservationError.message}` }, { status: 500 });
  }
  const list = (reservations ?? []) as {
    id: string;
    date: string;
    room_id: number;
    start_time: string;
    end_time: string;
  }[];

  const rows = slots.flatMap((s) => {
    if (s.date < month || s.date >= end) return [];
    const hit = list.find(
      (r) =>
        r.date === s.date &&
        r.room_id === s.roomId &&
        r.start_time.slice(0, 5) <= s.startTime &&
        r.end_time.slice(0, 5) >= s.endTime,
    );
    return hit
      ? [
          {
            reservation_id: hit.id,
            date: s.date,
            start_time: s.startTime,
            end_time: s.endTime,
            room_id: s.roomId,
            status: "genre",
            genre_id: s.genreId,
            published: false,
          },
        ]
      : [];
  });

  // **作ってから消す** (v1.50.2)。消してから作ると、作る側が失敗したときに下書きが消えたままになる。
  // slots には重なりの制約が無いので、一時的に新旧が並んでも書き込める
  const { data: oldDrafts, error: oldError } = await supabase
    .from("slots")
    .select("id")
    .gte("date", month)
    .lt("date", end)
    .eq("published", false);
  if (oldError) {
    return Response.json({ error: `下書きを作れませんでした: ${oldError.message}` }, { status: 500 });
  }
  const oldIds = ((oldDrafts ?? []) as { id: string }[]).map((row) => row.id);

  let newIds: string[] = [];
  if (rows.length > 0) {
    const { data: inserted, error: insertError } = await supabase.from("slots").insert(rows).select("id");
    if (insertError) {
      // 何も消していないので、前の下書きはそのまま残る
      return Response.json({ error: `下書きを作れませんでした: ${insertError.message}` }, { status: 500 });
    }
    newIds = ((inserted ?? []) as { id: string }[]).map((row) => row.id);
  }

  for (let i = 0; i < oldIds.length; i += 200) {
    const { error: deleteError } = await supabase.from("slots").delete().in("id", oldIds.slice(i, i + 200));
    if (deleteError) {
      // 前の下書きを消し切れなかった。新しく作ったぶんを消して、前の状態に寄せる
      for (let j = 0; j < newIds.length; j += 200) {
        await supabase.from("slots").delete().in("id", newIds.slice(j, j + 200));
      }
      return Response.json(
        { error: `下書きを作れませんでした (前の下書きの一部が消えています。もう一度押してください): ${deleteError.message}` },
        { status: 500 },
      );
    }
  }
  return Response.json({ created: rows.length });
}
