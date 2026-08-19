import { redirect } from "next/navigation";

import { CalendarView } from "@/components/CalendarView";
import { ClubKeyBoard } from "@/components/ClubKeyBoard";
import type { DayBlock } from "@/components/DayGrid";
import { RoomStatusBoard, type RoomStatusRow } from "@/components/RoomStatusBoard";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { KEY_HISTORY_LIMIT, toKeyHolderRows } from "@/lib/club-key";
import { GENRE_BY_ID, isCoordinatorOrAbove } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  endOfMonth,
  normalizeTime,
  startOfMonth,
  todayInTokyo,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

/**
 * タブ① 全体カレンダー (SPEC.md §6.1)
 *
 * 折衝が公開した slots と申請 claims を「ミニカレンダー → 日別ビュー」で見せる。
 *
 * サーバーは**その月ぶんをまとめて1クエリ**で取り (SPEC §13.1: slots+claims+profiles
 * を join)、日付の選択は CalendarView がクライアント側で行う。同じ月なら取りに行く
 * データが無いため、日付切り替えでサーバー往復を起こさない。
 *
 * 施錠状況ボード (§6.1.1) は**選択中の日付に関わらず常に今日**を見るため別クエリ。
 * 3本を Promise.all で並列に投げる (直列だと1本ぶんの遅延が3倍になる)。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

export default async function OverviewCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();

  // OB はタブ①を利用できない。URL 直打ちは /me へ (SPEC §3.6 / §6.0)
  if (profile?.role === "ob") {
    redirect("/me");
  }

  const { date } = await searchParams;
  const today = todayInTokyo();
  const selectedDate = date && DATE_PATTERN.test(date) ? date : today;

  const supabase = await createClient();

  const [monthResult, todayRoomsResult, roomStatusResult, keyHolderResult] =
    await Promise.all([
    // 1. 選択月の slots + claims + 申請者名 (SPEC §13.1)
    supabase
      .from("slots")
      .select(
        "id, date, start_time, end_time, room_id, status, genre_id, target_generations, note," +
          " claims(id, user_id, start_time, end_time, purpose, profiles(username))",
      )
      .eq("published", true)
      .gte("date", startOfMonth(selectedDate))
      .lte("date", endOfMonth(selectedDate)),

    // 2. 施錠ボードに並べる部屋 = 今日、公開済み slots が1件以上ある部屋 (§6.1.1)
    supabase
      .from("slots")
      .select("room_id")
      .eq("published", true)
      .eq("date", today),

    // 3. 今日の施錠状況と、最後に切り替えた人
    supabase
      .from("room_status")
      .select("room_id, is_unlocked, updated_at, profiles(username)")
      .eq("date", today),

    // 4. 部室の鍵の受け渡し (§6.1.2)。**日付では絞らない** —
    //    鍵は日をまたいで同じ人が持っているのが普通で、今日の行が無いのが常態
    supabase
      .from("club_key_holders")
      .select("id, user_id, taken_at, profiles(username)")
      .order("taken_at", { ascending: false })
      .limit(KEY_HISTORY_LIMIT),
    ]);

  // 日付ごとにまとめておく。クライアント側は選択日で引くだけで済む
  const blocksByDate: Record<DateString, DayBlock[]> = {};
  for (const row of (monthResult.data ?? []) as unknown as SlotRow[]) {
    (blocksByDate[row.date] ??= []).push({
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

  const todayRoomIds = [
    ...new Set(
      ((todayRoomsResult.data ?? []) as { room_id: number }[]).map(
        (r) => r.room_id,
      ),
    ),
  ];

  const error = monthResult.error ?? todayRoomsResult.error;

  return (
    /*
     * 縦を詰めるため見出しは sr-only にしてある。どのタブにいるかは
     * 下部タブバーが示しており、画面内に大きな見出しを置くぶんだけ
     * 日別ビューが下に押し出されていた。読み上げには残す。
     */
    <main className="mx-auto max-w-2xl space-y-2 px-4 py-2">
      <h1 className="sr-only">全体カレンダー</h1>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8B1A10]"
        >
          予定の取得に失敗しました: {error.message}
        </p>
      ) : null}

      {/* 選択日に関わらず常に「今日」を示すカード。ミニカレンダーより上 (§6.1.1) */}
      <RoomStatusBoard
        today={today}
        roomIds={todayRoomIds}
        initialRows={
          (roomStatusResult.data ?? []) as unknown as RoomStatusRow[]
        }
        currentUserId={profile?.user_id ?? ""}
      />

      {/* 部室の鍵の所持者 (§6.1.2)。施錠ボードとミニカレンダーの間 */}
      <ClubKeyBoard
        initialRows={toKeyHolderRows(keyHolderResult.data)}
        currentUserId={profile?.user_id ?? ""}
      />

      {/*
        key を渡して、サーバーが別の日付を返したときに CalendarView を作り直す。
        これが無いと、月送りやブラウザの戻るでサーバーの選択日が変わっても
        クライアント state に前の日付が残り、表示中の月に無い日を選んだ状態になる
        (useState の初期値は再レンダーでは効かないため)。
      */}
      <CalendarView
        key={selectedDate}
        monthAnchor={startOfMonth(selectedDate)}
        initialDate={selectedDate}
        today={today}
        markedDates={Object.keys(blocksByDate)}
        blocksByDate={blocksByDate}
        currentUserId={profile?.user_id ?? ""}
        canManage={profile ? isCoordinatorOrAbove(profile.role) : false}
      />
    </main>
  );
}
