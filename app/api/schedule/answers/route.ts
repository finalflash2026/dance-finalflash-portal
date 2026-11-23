import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/session";
import { isActiveMember } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

/**
 * PUT /api/schedule/answers  (SPEC.md §6.8.5 / v1.44)
 *
 * 自分の回答を保存する。**ログインしている本人のセッションで書く**ので、
 * 「自分の行だけ・受付中の回だけ」は RLS が確かめる。answer が null なら未回答に戻す (行を消す)。
 */
export const runtime = "nodejs";

const time = z.string().regex(/^\d{2}:\d{2}$/);
const schema = z.object({
  roundId: z.string().uuid(),
  changes: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: time,
        endTime: time,
        answer: z.enum(["ok", "maybe", "no"]).nullable(),
      }),
    )
    .min(1)
    .max(600),
});

export async function PUT(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  // OB と閲覧のみ (§3.8) は答えない。DB の RLS でも止めている (0029)
  if (!isActiveMember(profile.role)) {
    return Response.json({ error: "日程調整には答えられません。" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "回答の形が正しくありません。" }, { status: 400 });
  }
  const { roundId, changes } = parsed.data;
  const supabase = await createClient();

  const upserts = changes
    .filter((c) => c.answer)
    .map((c) => ({
      round_id: roundId,
      user_id: profile.user_id,
      date: c.date,
      start_time: c.startTime,
      end_time: c.endTime,
      answer: c.answer!,
      updated_at: new Date().toISOString(),
    }));
  if (upserts.length > 0) {
    const { error } = await supabase
      .from("schedule_answers")
      .upsert(upserts, { onConflict: "round_id,user_id,date,start_time,end_time" });
    if (error) return failed(error);
  }

  for (const c of changes.filter((c) => !c.answer)) {
    const { error } = await supabase
      .from("schedule_answers")
      .delete()
      .eq("round_id", roundId)
      .eq("user_id", profile.user_id)
      .eq("date", c.date)
      .eq("start_time", c.startTime)
      .eq("end_time", c.endTime);
    if (error) return failed(error);
  }

  return Response.json({ ok: true });
}

function failed(error: { code?: string; message: string }) {
  // RLS に弾かれた = 受付が終わっている
  if (error.code === "42501") {
    return Response.json({ error: "受付が終わっているので保存できませんでした。" }, { status: 403 });
  }
  return Response.json({ error: `保存できませんでした: ${error.message}` }, { status: 500 });
}
