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
  // 予定と所属ナンバーを**同時に**取る。片方ずつ待つ理由が無い
  const [{ data, error }, numbersResult] = await Promise.all([
    supabase
      .from("number_events")
      .select(
        "id, number_id, date, start_time, end_time, place, note, numbers(name)",
      )
      .gte("date", startOfMonth(selectedDate))
      .lte("date", endOfMonth(selectedDate))
      .order("date"),
    supabase
      .from("numbers")
      .select("id, name, owner_id, number_members(user_id)")
      .order("created_at"),
  ]);

  // 絞り込みはクエリに書いていない。RLS の sel_numbers (= is_number_member) が
  // そのまま効いていて、非メンバーにはナンバーの存在自体が見えない
  const numbers = (
    (numbersResult.data ?? []) as unknown as {
      id: string;
      name: string;
      owner_id: string;
      number_members: { user_id: string }[] | null;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    isOwner: row.owner_id === profile.user_id,
    memberCount: (row.number_members ?? []).length,
  }));

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
      <h1 className="sr-only">ナンバー</h1>

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
        numbers={numbers}
        numbersError={numbersResult.error?.message ?? null}
      />
    </main>
  );
}
