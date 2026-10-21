import highsLoader from "highs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { hasSupabaseEnv } from "@/lib/env";
import { plan } from "@/lib/scheduling/plan";
import type { PlanInput } from "@/lib/scheduling/types";

/**
 * POST /api/schedule/plan  (SPEC.md §6.8.3 / v1.32 デモ)
 *
 * 日程調整の回答から割り振りの案を作る。**計算はサーバーで行う** —
 * ソルバー (HiGHS の WASM) を端末に配らずに済み、DB を作ったあとは
 * 回答を DB から読んで計算の記録 (plan_runs) を残す場所になる。
 *
 * **いまはデモだけ**: Supabase 未設定の手元の環境でだけ、画面から送られた
 * 見本の回答で計算する。本番は回答の保存 (DB) を作るまで 404。
 * 本番では回答を画面から受け取らない (改ざんできてしまうため。DB から読む)。
 */
export const runtime = "nodejs";
/** 計算は数秒〜十数秒かかる (Vercel の CPU では手元の 3〜5倍)。余裕を持たせる */
export const maxDuration = 60;

const time = z.string().regex(/^\d{2}:\d{2}$/);
const answer = z.enum(["ok", "maybe", "no"]);

const schema = z.object({
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
    minPeople: z.number().min(0).max(200),
    timeLimitSeconds: z.number().min(1).max(50),
  }),
});

/** ソルバーの読み込みは重いので、同じサーバーの中では使い回す */
let solverPromise: ReturnType<typeof highsLoader> | null = null;

export async function POST(request: Request) {
  if (hasSupabaseEnv()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が正しくありません" },
      { status: 400 },
    );
  }

  solverPromise ??= highsLoader();
  const solver = await solverPromise;
  const result = plan(parsed.data.input as PlanInput, parsed.data.settings, solver);
  return NextResponse.json(result);
}
