import highsLoader from "highs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";
import { hasSupabaseEnv } from "@/lib/env";
import { plan } from "@/lib/scheduling/plan";
import { getRoundForMonth, loadMonthInput } from "@/lib/scheduling/live";
import type { PlanInput } from "@/lib/scheduling/types";
import type { DateString } from "@/lib/types";

/**
 * POST /api/schedule/plan  (SPEC.md §6.8.3 / v1.32 デモ)
 *
 * 日程調整の回答から割り振りの案を作る。**計算はサーバーで行う** —
 * ソルバー (HiGHS の WASM) を端末に配らずに済み、DB を作ったあとは
 * 回答を DB から読んで計算の記録 (plan_runs) を残す場所になる。
 *
 * **折衝・3役だけ** (§6.8.1 / v1.32.4)。DB を作る段階で requireRole("coordinator") を
 * ここに置く (いまは本番で開けないので、下の 404 がその代わり)。
 *
 * **いまはデモだけ**: 画面から送られた回答で計算する (v1.35 からは Supabase に
 * つないだデモ環境でも、折衝・3役なら呼べる)。回答の保存 (DB) を作ったあとは、
 * 回答を画面から受け取らない (改ざんできてしまうため。DB から読む)。
 */
export const runtime = "nodejs";
/** 計算は数秒〜十数秒かかる (Vercel の CPU では手元の 3〜5倍)。余裕を持たせる */
export const maxDuration = 60;

const time = z.string().regex(/^\d{2}:\d{2}$/);
const answer = z.enum(["ok", "maybe", "no"]);

const schema = z.object({
  /** Supabase のある環境では、この月の回答を DB から読む (v1.44) */
  month: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  input: z.object({
    genres: z.array(z.object({ id: z.number().int(), code: z.string().max(20) })).max(20),
    candidates: z
      .array(
        z.object({
          id: z.string().max(80),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          section: z.string().max(40),
          roomId: z.number().int(),
          startTime: time,
          endTime: time,
        }),
      )
      .max(600),
    members: z
      .array(z.object({ id: z.string().max(80), name: z.string().max(80), genres: z.array(z.number().int()).max(3) }))
      .max(400),
    answers: z.record(z.string(), z.record(z.string(), answer)),
  }),
  settings: z.object({
    maybeWeight: z.number().min(0).max(1),
    genreWeights: z.tuple([z.number().min(0).max(2), z.number().min(0).max(2), z.number().min(0).max(2)]),
    perGenre: z.number().int().min(0).max(100),
    maxPerDay: z.number().int().min(1).max(10),
    sameRoomBonus: z.number().min(0).max(20),
    roomWeights: z.record(z.string(), z.number().min(0.1).max(3)),
    fairnessWeight: z.number().min(0).max(20),
    fairnessTarget: z.number().min(0).max(1),
    minBigPerGenre: z.number().int().min(0).max(10),
    minPeople: z.number().min(0).max(200),
    timeLimitSeconds: z.number().min(1).max(50),
  }),
});

/** ソルバーの読み込みは重いので、同じサーバーの中では使い回す */
let solverPromise: ReturnType<typeof highsLoader> | null = null;

export async function POST(request: Request) {
  // 折衝・3役だけ (§6.8.1)。Supabase につないだデモ環境 (v1.35) でも確かめる。
  // 手元の環境 (Supabase 未設定) は誰でも見本で試せる
  if (hasSupabaseEnv()) {
    const guard = await requireRole("coordinator");
    if (guard instanceof Response) return guard;
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が正しくありません" },
      { status: 400 },
    );
  }

  // **画面から回答を受け取らない** (v1.44)。DB から読んで計算する (改ざんさせない)
  let input = parsed.data.input as PlanInput;
  if (hasSupabaseEnv()) {
    const month = parsed.data.month as DateString | undefined;
    if (!month) {
      return NextResponse.json({ error: "月がありません。" }, { status: 400 });
    }
    const round = await getRoundForMonth(month, null);
    input = await loadMonthInput(month, round?.id ?? null);
  }

  solverPromise ??= highsLoader();
  const solver = await solverPromise;
  const result = plan(input, parsed.data.settings, solver);
  return NextResponse.json(result);
}
