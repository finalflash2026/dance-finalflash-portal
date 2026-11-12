import { redirect } from "next/navigation";

import type { DayBlock } from "@/components/DayGrid";
import { SetupNotice } from "@/components/SetupNotice";
import { canUseCoordinator } from "@/lib/auth/guard";
import { getCurrentProfile } from "@/lib/auth/session";
import { GENRE_BY_ID, isActiveMember } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents, getMyGenreIds } from "@/lib/events";
import { isMissingRelation } from "@/lib/schema-errors";
import { getOpenRound } from "@/lib/scheduling/live";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  addMonths,
  endOfMonth,
  normalizeTime,
  startOfMonth,
  todayInTokyo,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

import { CalendarHome, type KeysSummary, type UpcomingDeadline } from "./CalendarHome";

/**
 * ホーム (SPEC.md §6.7.13 / v1.31)
 *
 * **開いてすぐ見たいものだけ**を置く: 近い締切 / 今日自主練できる部屋 /
 * 鍵まわりの入口 / 1週間の帯 + 選んだ日の予定 (開いた直後は今日)。鍵のボードは /keys、お知らせはベルへ移した。
 *
 * 週の帯は横に滑らせて前後の週へ行けるので、**表示中の月の前後1か月ぶん**をまとめて取る。
 * その外へ滑らせたら、その日付でページごと読み直す (CalendarHome)。
 * 日付の選択はクライアントで完結する (§13.1)。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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

export default async function HomePage({
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
  // 選んだ日の前後2か月 (v1.35)。端に近づいたら画面側がその日を中心に読み直す
  const rangeStart = startOfMonth(addMonths(selectedDate, -2));
  const rangeEnd = endOfMonth(addMonths(selectedDate, 2));
  const todayInRange = today >= rangeStart && today <= rangeEnd;

  const isOb = profile.role === "ob";
  const supabase = await createClient();
  // OB は全体の練習・鍵・締切を持たない (§3.6)。空の結果で埋めて形だけ揃える
  const none = Promise.resolve({ data: [] as unknown[], error: null });

  const [
    events,
    numberResult,
    genreIds,
    rangeSlotsResult,
    todaySlotsResult,
    roomStatusResult,
    keyHolderResult,
    deadlineResult,
  ] = await Promise.all([
    getMyEvents(supabase, profile, rangeStart, rangeEnd),
    // 所属ナンバー (絞り込みと色の割り当て)。**user_id で必ず絞る** (§6.4 / v1.12)
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
          .gte("date", rangeStart)
          .lte("date", rangeEnd),
    // 「今日自主練できる部屋」は常に今日。範囲に今日が入っていれば取らない
    isOb || todayInRange
      ? none
      : supabase.from("slots").select(SLOT_COLUMNS).eq("published", true).eq("date", today),
    // 鍵の入口に出す要約だけ (開いている部屋の数)。ボード本体は /keys
    isOb
      ? none
      : supabase.from("room_status").select("room_id, is_unlocked").eq("date", today),
    isOb
      ? none
      : supabase
          .from("club_key_holders")
          .select("profiles(username)")
          .order("taken_at", { ascending: false })
          .limit(1),
    isOb
      ? none
      : supabase
          .from("deadlines")
          .select("id, title, due_date, due_time, url, important, note")
          .gte("due_date", today)
          .lte("due_date", addDays(today, UPCOMING_DEADLINE_DAYS))
          .order("due_date", { ascending: true }),
  ]);

  const blocksByDate = toBlocksByDate([
    ...((rangeSlotsResult.data ?? []) as SlotRow[]),
    ...((todaySlotsResult.data ?? []) as SlotRow[]),
  ]);

  const numbers = (
    (numberResult.data ?? []) as unknown as {
      numbers: { id: string; name: string } | null;
    }[]
  )
    .map((row) => row.numbers)
    .filter((number): number is { id: string; name: string } => number !== null);

  const upcomingDeadlines: UpcomingDeadline[] = (
    (deadlineResult.data ?? []) as {
      id: string;
      title: string;
      due_date: DateString;
      due_time: string | null;
      url: string | null;
      important: boolean;
      note: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    dueTime: row.due_time ? normalizeTime(row.due_time) : null,
    url: row.url,
    important: row.important,
    note: row.note,
  }));

  const keysSummary: KeysSummary | null = isOb
    ? null
    : {
        unlocked: ((roomStatusResult.data ?? []) as { is_unlocked: boolean }[]).filter(
          (row) => row.is_unlocked,
        ).length,
        holder:
          (
            (keyHolderResult.data ?? []) as unknown as {
              profiles: { username: string } | null;
            }[]
          )[0]?.profiles?.username ?? null,
      };

  // 締切の表が無い DB (0020 の前。v1.49) では締切の欄を出さないだけにする
  const error =
    rangeSlotsResult.error ??
    todaySlotsResult.error ??
    (isMissingRelation(deadlineResult.error) ? null : deadlineResult.error);

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-2">
      <h1 className="sr-only">ホーム</h1>

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
        読み込み範囲の外へ滑らせて読み直したときに、古い state が残らないように
      */}
      <CalendarHome
        key={selectedDate}
        // 日程調整の回 (デモ環境で試せる。§6.8.4 / v1.35)。OB には出さない
        scheduleRound={isActiveMember(profile.role) ? await getOpenRound(today, profile.user_id) : null}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        initialDate={selectedDate}
        today={today}
        events={events}
        blocksByDate={blocksByDate}
        numbers={numbers}
        genreCodes={genreIds.flatMap((id) => {
          const code = GENRE_BY_ID.get(id)?.code;
          return code ? [code as string] : [];
        })}
        isOb={isOb}
        currentUserId={profile.user_id}
        upcomingDeadlines={upcomingDeadlines}
        keysSummary={keysSummary}
        staffHref={canUseCoordinator(profile) ? "/coordinator" : null}
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
