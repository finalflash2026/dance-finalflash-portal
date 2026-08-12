import { redirect } from "next/navigation";

import { CalendarView } from "@/components/CalendarView";
import type { DayBlock } from "@/components/DayGrid";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { GENRE_BY_ID } from "@/lib/constants";
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
 * 折衝が公開した slots を「ミニカレンダー → 日別ビュー」で見せる。
 *
 * サーバーは**その月ぶんをまとめて1クエリ**で取り (SPEC §13.1)、
 * 日付の選択は CalendarView がクライアント側で行う。同じ月なら取りに行く
 * データが無いため、日付切り替えでサーバー往復を起こさないようにしている。
 * URL の ?date= はどちらの経路でも有効 (共有・リロード・月送りの起点)。
 *
 * Phase 2 で追加するもの: 施錠状況ボード (§6.1.1)、空き申請と claims の描画。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

  // その月ぶんを1クエリで取得する (SPEC §13.1)
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("slots")
    .select(
      "id, date, start_time, end_time, room_id, status, genre_id, target_generations, note",
    )
    .eq("published", true)
    .gte("date", startOfMonth(selectedDate))
    .lte("date", endOfMonth(selectedDate));

  // 日付ごとにまとめておく。クライアント側は選択日で引くだけで済む
  const blocksByDate: Record<DateString, DayBlock[]> = {};
  for (const row of (data ?? []) as SlotRow[]) {
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
    });
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <h1 className="text-xl font-bold">全体カレンダー</h1>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8B1A10]"
        >
          予定の取得に失敗しました: {error.message}
        </p>
      ) : null}

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
      />
    </main>
  );
}
