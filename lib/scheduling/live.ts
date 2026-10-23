import "server-only";

import { GENRES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { addMonths } from "@/lib/time";

import { candidatesFromReservations } from "./candidates";
import type { ScheduleRound } from "./round";
import { scenarioAnswers } from "./scenarios";
import type { Member, PlanInput } from "./types";

/**
 * デモ環境の日程調整 (SPEC.md §6.8.4 / v1.35) の入力を DB から作る。
 *
 * - 候補: その月の予約枠 (reservations) をコマの時間に割ったもの
 * - 部員: 現役 (OB を除く) と 1〜3ジャン
 * - 回答: **まだ DB に保存しない**ので、見本で埋める。見ている人の回答は画面側で
 *   端末に保存したものに差し替える
 *
 * 予約枠は折衝以上しか読めない (RLS) が、メンバーも回答のために日時と部屋を
 * 知る必要があるので、サーバーで service role を使って読む。返すのは日時・部屋だけ。
 */
export async function loadLiveRoundInput(round: ScheduleRound): Promise<PlanInput> {
  const admin = createAdminClient();
  const [reservations, profiles, subgenres] = await Promise.all([
    admin
      .from("reservations")
      .select("date, start_time, end_time, room_id, rooms(section)")
      .eq("status", "active")
      .gte("date", round.month)
      .lt("date", addMonths(round.month, 1)),
    admin.from("profiles").select("user_id, username, main_genre_id").neq("role", "ob"),
    admin.from("user_subgenres").select("user_id, slot, genre_id"),
  ]);

  const candidates = candidatesFromReservations(
    ((reservations.data ?? []) as unknown as {
      date: string;
      start_time: string;
      end_time: string;
      room_id: number;
      rooms: { section: string } | null;
    }[]).map((r) => ({
      date: r.date,
      startTime: r.start_time.slice(0, 5),
      endTime: r.end_time.slice(0, 5),
      roomId: r.room_id,
      section: r.rooms?.section ?? "",
    })),
  );

  const subs = new Map<string, number[]>();
  for (const row of (subgenres.data ?? []) as { user_id: string; slot: number; genre_id: number }[]) {
    const list = subs.get(row.user_id) ?? [];
    list[row.slot - 2] = row.genre_id;
    subs.set(row.user_id, list);
  }
  const members: Member[] = ((profiles.data ?? []) as { user_id: string; username: string; main_genre_id: number }[]).map(
    (p) => ({
      id: p.user_id,
      name: p.username,
      genres: [p.main_genre_id, ...(subs.get(p.user_id) ?? []).filter(Boolean)],
    }),
  );

  return {
    genres: GENRES.map((g) => ({ id: g.id, code: g.code })),
    candidates,
    members,
    // 種は月から決める (開くたびに同じ見本になる)
    answers: scenarioAnswers(members, candidates, Number(round.month.replace(/-/g, "").slice(0, 6))),
  };
}
