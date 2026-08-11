import { redirect } from "next/navigation";

import { DayGrid, type DayBlock } from "@/components/DayGrid";
import { MiniCalendar } from "@/components/MiniCalendar";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { GENRE_BY_ID } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  endOfMonth,
  formatDateLabel,
  normalizeTime,
  startOfMonth,
  todayInTokyo,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

/**
 * タブ① 全体カレンダー (SPEC.md §6.1)
 *
 * 折衝が公開した slots を「ミニカレンダー → 日別ビュー」で見せる。
 * 選択中の日付は URL (?date=) が持つので、Server Component だけで完結する。
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
  const selectedDate =
    date && DATE_PATTERN.test(date) ? date : todayInTokyo();

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

  const rows = (data ?? []) as SlotRow[];
  const markedDates = [...new Set(rows.map((row) => row.date))];
  const blocks: DayBlock[] = rows
    .filter((row) => row.date === selectedDate)
    .map((row) => ({
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
    }));

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

      <MiniCalendar
        basePath="/"
        selectedDate={selectedDate}
        markedDates={markedDates}
      />

      <section className="space-y-2">
        <h2 className="text-base font-bold">
          {formatDateLabel(selectedDate)} の練習
        </h2>
        <DayGrid date={selectedDate} blocks={blocks} />
      </section>
    </main>
  );
}
