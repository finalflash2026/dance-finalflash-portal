import { redirect } from "next/navigation";

import type { DayBlock } from "@/components/DayGrid";
import type { NotificationRow } from "@/components/NotificationList";
import type { RoomStatusRow } from "@/components/RoomStatusBoard";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { toBoardMessages } from "@/lib/board-messages";
import { KEY_HISTORY_LIMIT, toKeyHolderRows } from "@/lib/club-key";
import { GENRE_BY_ID } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents, getMyGenreIds } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  endOfMonth,
  normalizeTime,
  startOfMonth,
  todayInTokyo,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

import { CalendarHome, type UpcomingDeadline } from "./CalendarHome";

/**
 * カレンダー (SPEC.md §6.7.7 / v1.30)
 *
 * **マイカレンダー (§6.4) と全体カレンダー (§6.1) を1つにまとめた画面。**
 * 予定を見るために2つのタブを行き来する理由が無かった。
 *
 * サーバーで取るもの (すべて並列):
 *   - 自分の予定 (getMyEvents。購読 ics と同じ抽出。§6.4)
 *   - その月の公開済みコマと申請 … 他ジャンルの練習・空きを薄く出すのと、
 *     「部屋ごと」の表・いま空いている部屋に使う (現役のみ)
 *   - 鍵のボード・部室の鍵・連絡 (現役のみ。常に今日)
 *   - 近い締切 (今日から14日。表示中の月に関係なく)
 *   - 未読のお知らせ・所属ナンバー・自分のジャンル (絞り込みチップ)
 *
 * 日付の選択はクライアントで完結する (月ぶんをまとめて取っているため)。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NOTIFICATION_LIMIT = 20;
/** 「近い締切」に並べる範囲 (§6.7.2) */
const UPCOMING_DEADLINE_DAYS = 14;

type ClaimRow = {
  id: string;
  user_id: string;
  start_time: string;
  end_time: string;
  purpose: string | null;
  profiles: { username: string } | null;
};

type SlotRow = {
  id: string;
  date: DateString;
  start_time: string;
  end_time: string;
  room_id: number;
  status: SlotStatus;
  genre_id: number | null;
  target_generations: number[] | null;
  note: string | null;
  claims: ClaimRow[] | null;
};

const SLOT_COLUMNS =
  "id, date, start_time, end_time, room_id, status, genre_id, target_generations, note," +
  " claims(id, user_id, start_time, end_time, purpose, profiles(username))";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const { date } = await searchParams;
  const today = todayInTokyo();
  const selectedDate: DateString =
    date && DATE_PATTERN.test(date) ? date : today;
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const todayInMonth = today >= monthStart && today <= monthEnd;

  const isOb = profile.role === "ob";
  const supabase = await createClient();

  // OB は全体の練習・鍵・締切を持たない (§3.6)。空の結果で埋めて形だけ揃える
  const none = Promise.resolve({ data: [] as unknown[], error: null });

  const [
    events,
    notificationResult,
    numberResult,
    genreIds,
    monthSlotsResult,
    todaySlotsResult,
    roomStatusResult,
    keyHolderResult,
    messagesResult,
    deadlineResult,
  ] = await Promise.all([
    getMyEvents(supabase, profile, monthStart, monthEnd),
    // 未読だけ (§6.4-2 / v1.10)
    supabase
      .from("notifications")
      .select("id, type, title, body, created_at")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_LIMIT),
    // 絞り込みチップの所属ナンバー。**user_id で必ず絞る** (§6.4 / v1.12)
    supabase
      .from("number_members")
      .select("numbers(id, name)")
      .eq("user_id", profile.user_id),
    isOb ? Promise.resolve([]) : getMyGenreIds(supabase, profile),
    isOb
      ? none
      : supabase
          .from("slots")
          .select(SLOT_COLUMNS)
          .eq("published", true)
          .gte("date", monthStart)
          .lte("date", monthEnd),
    // いま空いている部屋と鍵のボードは**常に今日**を見る。
    // 表示中の月に今日が入っていれば月ぶんの中にあるので取らない
    isOb || todayInMonth
      ? none
      : supabase.from("slots").select(SLOT_COLUMNS).eq("published", true).eq("date", today),
    isOb
      ? none
      : supabase
          .from("room_status")
          .select("room_id, is_unlocked, updated_at, profiles(username)")
          .eq("date", today),
    isOb
      ? none
      : supabase
          .from("club_key_holders")
          .select("id, user_id, taken_at, profiles(username)")
          .order("taken_at", { ascending: false })
          .limit(KEY_HISTORY_LIMIT),
    isOb
      ? none
      : supabase
          .from("board_messages")
          .select("id, scope, date, body, user_id, created_at, profiles(username)")
          .or(`and(scope.eq.room,date.eq.${today}),scope.eq.club_key`)
          .order("created_at", { ascending: true }),
    isOb
      ? none
      : supabase
          .from("deadlines")
          .select("id, title, due_date, due_time, url, important")
          .gte("due_date", today)
          .lte("due_date", addDays(today, UPCOMING_DEADLINE_DAYS))
          .order("due_date", { ascending: true }),
  ]);

  const blocksByDate = toBlocksByDate([
    ...((monthSlotsResult.data ?? []) as SlotRow[]),
    ...((todaySlotsResult.data ?? []) as SlotRow[]),
  ]);

  const numbers = (
    (numberResult.data ?? []) as unknown as {
      numbers: { id: string; name: string } | null;
    }[]
  )
    .map((row) => row.numbers)
    .filter((number): number is { id: string; name: string } => number !== null);

  const notifications: NotificationRow[] = (
    (notificationResult.data ?? []) as unknown as {
      id: string;
      type: NotificationRow["type"];
      title: string;
      body: string | null;
      created_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  }));

  const messageRows = (messagesResult.data ?? []) as unknown as {
    scope: "room" | "club_key";
  }[];

  const upcomingDeadlines: UpcomingDeadline[] = (
    (deadlineResult.data ?? []) as {
      id: string;
      title: string;
      due_date: DateString;
      due_time: string | null;
      url: string | null;
      important: boolean;
    }[]
  ).map((row) => ({
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    dueTime: row.due_time ? normalizeTime(row.due_time) : null,
    url: row.url,
    important: row.important,
  }));

  const error =
    monthSlotsResult.error ?? todaySlotsResult.error ?? deadlineResult.error;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-2">
      <h1 className="sr-only">カレンダー</h1>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]"
        >
          予定の取得に失敗しました: {error.message}
        </p>
      ) : null}

      {/*
        key を渡して、サーバーが別の日付を返したときに作り直す。
        月送りやブラウザの戻りでクライアント state が取り残されるのを防ぐ
        (useState の初期値は再レンダーでは効かない)。
      */}
      <CalendarHome
        key={selectedDate}
        monthAnchor={monthStart}
        initialDate={selectedDate}
        today={today}
        events={events}
        blocksByDate={blocksByDate}
        notifications={notifications}
        numbers={numbers}
        genreCodes={genreIds.flatMap((id) => {
          const code = GENRE_BY_ID.get(id)?.code;
          return code ? [code as string] : [];
        })}
        isOb={isOb}
        currentUserId={profile.user_id}
        upcomingDeadlines={upcomingDeadlines}
        boards={
          isOb
            ? null
            : {
                roomStatusRows: (roomStatusResult.data ?? []) as unknown as RoomStatusRow[],
                roomMessages: toBoardMessages(
                  messageRows.filter((row) => row.scope === "room"),
                ),
                keyHolderRows: toKeyHolderRows(keyHolderResult.data),
                keyMessages: toBoardMessages(
                  messageRows.filter((row) => row.scope === "club_key"),
                ),
              }
        }
      />
    </main>
  );
}

/** コマを日付ごとにまとめる。クライアントは選んだ日で引くだけで済む */
function toBlocksByDate(rows: SlotRow[]): Record<DateString, DayBlock[]> {
  const byDate: Record<DateString, DayBlock[]> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    (byDate[row.date] ??= []).push({
      id: row.id,
      roomId: row.room_id,
      startTime: normalizeTime(row.start_time),
      endTime: normalizeTime(row.end_time),
      status: row.status,
      genreCode: row.genre_id
        ? (GENRE_BY_ID.get(row.genre_id)?.code ?? null)
        : null,
      targetGenerations: row.target_generations,
      note: row.note,
      claims: (row.claims ?? []).map((claim) => ({
        id: claim.id,
        userId: claim.user_id,
        username: claim.profiles?.username ?? "(不明)",
        startTime: normalizeTime(claim.start_time),
        endTime: normalizeTime(claim.end_time),
        purpose: claim.purpose,
      })),
    });
  }
  return byDate;
}
