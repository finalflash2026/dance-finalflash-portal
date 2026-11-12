import "server-only";

import { GENRES, OFF_ROSTER_ROLES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { addMonths } from "@/lib/time";
import type { DateString } from "@/lib/types";

import { candidatesFromReservations } from "./candidates";
import { answerKey } from "./plan";
import type { ScheduleRound } from "./round";
import type { Answer, AnswerKey, Member, PlanInput } from "./types";

/**
 * 日程調整を DB から読む (SPEC.md §6.8.5 / v1.44)。
 *
 * 予約枠・名簿・全員の回答は折衝以上しか読めない (RLS) が、メンバーも回答のために
 * 候補の日時を知る必要があり、ホームには回答した人数を出すので、**サーバーで
 * service role を使って読む**。呼ぶ側で権限を確かめ、メンバーには自分の回答と
 * 人数しか渡さないこと。
 */

interface RoundRow {
  id: string;
  month: DateString;
  deadline: DateString;
  status: "open" | "closed";
}

/** 回の行に、回答した人数・現役の人数・見ている人が答えたかを付ける */
async function withCounts(row: RoundRow, viewerId: string | null): Promise<ScheduleRound> {
  const admin = createAdminClient();
  const [answers, members] = await Promise.all([
    admin.from("schedule_answers").select("user_id").eq("round_id", row.id),
    admin.from("profiles").select("user_id", { count: "exact", head: true }).not("role", "in", OFF_ROSTER_ROLES),
  ]);
  const answered = new Set(((answers.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  return {
    id: row.id,
    month: row.month,
    deadline: row.deadline,
    status: row.status,
    answeredCount: answered.size,
    memberCount: members.count ?? 0,
    answeredByMe: viewerId ? answered.has(viewerId) : false,
  };
}

/**
 * 受付中の回 (ホームのカード・回答の画面・アプリの要約)。締切の日を過ぎたもの・
 * 締め切ったものは出さない。複数あれば月の早いもの
 */
export async function getOpenRound(today: DateString, viewerId: string | null): Promise<ScheduleRound | null> {
  const { data } = await createAdminClient()
    .from("schedule_rounds")
    .select("id, month, deadline, status")
    .eq("status", "open")
    .gte("deadline", today)
    .order("month", { ascending: true })
    .limit(1);
  const row = (data ?? [])[0] as RoundRow | undefined;
  return row ? withCounts(row, viewerId) : null;
}

/** その月の回 (無ければ null)。折衝の画面の「日程調整」の欄 */
export async function getRoundForMonth(month: DateString, viewerId: string | null): Promise<ScheduleRound | null> {
  const { data } = await createAdminClient()
    .from("schedule_rounds")
    .select("id, month, deadline, status")
    .eq("month", month)
    .maybeSingle();
  return data ? withCounts(data as RoundRow, viewerId) : null;
}

/**
 * その月の割り振りの入力。候補はその月の予約枠から作り、回答は DB から読む。
 * `onlyUser` を渡すとその人の回答だけ (回答の画面)、名簿も入れない
 */
export async function loadMonthInput(
  month: DateString,
  roundId: string | null,
  options: { onlyUser?: string } = {},
): Promise<PlanInput> {
  const admin = createAdminClient();
  let answersQuery = admin
    .from("schedule_answers")
    .select("user_id, date, start_time, end_time, answer")
    .eq("round_id", roundId ?? "00000000-0000-0000-0000-000000000000");
  if (options.onlyUser) answersQuery = answersQuery.eq("user_id", options.onlyUser);

  const [reservations, profiles, subgenres, answerRows] = await Promise.all([
    admin
      .from("reservations")
      .select("date, start_time, end_time, room_id, rooms(section)")
      .eq("status", "active")
      .gte("date", month)
      .lt("date", addMonths(month, 1)),
    options.onlyUser
      ? Promise.resolve({ data: [] })
      : admin.from("profiles").select("user_id, username, main_genre_id").not("role", "in", OFF_ROSTER_ROLES),
    options.onlyUser ? Promise.resolve({ data: [] }) : admin.from("user_subgenres").select("user_id, slot, genre_id"),
    roundId ? answersQuery : Promise.resolve({ data: [] }),
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

  const answers: Record<string, Partial<Record<AnswerKey, Answer>>> = {};
  for (const row of (answerRows.data ?? []) as {
    user_id: string;
    date: string;
    start_time: string;
    end_time: string;
    answer: Answer;
  }[]) {
    (answers[row.user_id] ??= {})[answerKey(row.date, row.start_time.slice(0, 5), row.end_time.slice(0, 5))] =
      row.answer;
  }

  return {
    genres: GENRES.map((g) => ({ id: g.id, code: g.code })),
    candidates,
    members,
    answers,
  };
}
