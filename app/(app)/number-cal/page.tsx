import { redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  endOfMonth,
  normalizeTime,
  startOfMonth,
  todayInTokyo,
} from "@/lib/time";
import type { DateString } from "@/lib/types";

import { NumberCalendarClient } from "./NumberCalendarClient";

/**
 * タブ② ナンバーカレンダー (SPEC.md §6.3)
 *
 * 所属ナンバーの予定だけを「ミニカレンダー → 日別の縦タイムライン」で見せる。
 * 非メンバーにはナンバーの存在自体が見えない — 絞り込みはクエリに書いておらず、
 * RLS の `sel_nevents` (= is_number_member) がそのまま効いている。
 *
 * タブ①と同じく**その月ぶんをまとめて1クエリ**で取り (SPEC §13.1)、
 * 日付の選択はクライアント側で行う (同じ月なら取りに行くデータが無いため)。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function NumberCalendarPage({
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("number_events")
    .select("id, number_id, date, start_time, end_time, place, note, numbers(name)")
    .gte("date", startOfMonth(selectedDate))
    .lte("date", endOfMonth(selectedDate))
    .order("date");

  const events = (
    (data ?? []) as unknown as {
      id: string;
      number_id: string;
      date: DateString;
      start_time: string;
      end_time: string;
      place: string;
      note: string | null;
      numbers: { name: string } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    numberId: row.number_id,
    numberName: row.numbers?.name ?? "ナンバー練",
    date: row.date,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    place: row.place,
    note: row.note,
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-2 px-4 py-2">
      <h1 className="sr-only">ナンバーカレンダー</h1>

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
        これが無いと月送りやブラウザの戻るでクライアント state が取り残される
        (useState の初期値は再レンダーでは効かないため)。タブ①と同じ理由。
      */}
      <NumberCalendarClient
        key={selectedDate}
        monthAnchor={startOfMonth(selectedDate)}
        initialDate={selectedDate}
        today={today}
        events={events}
        currentUserId={profile.user_id}
      />
    </main>
  );
}
