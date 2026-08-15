import { redirect } from "next/navigation";

import type { NotificationRow } from "@/components/NotificationList";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { getMyEvents } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import {
  endOfMonth,
  startOfMonth,
  todayInTokyo,
} from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

import { MyCalendarClient } from "./MyCalendarClient";

/**
 * タブ③ マイカレンダー (SPEC.md §6.4)
 *
 * 公式練・自分の空き申請・ナンバー練を1つのカレンダーに統合する。
 * 抽出は購読ics と同じ getMyEvents() を使う。片方だけ条件がズレると
 * 「サイトには出るが ics に出ない」という事故になるため、必ず共用する。
 *
 * OB は getMyEvents() の中でナンバー練のみに絞られる (SPEC §6.4-0)。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NOTIFICATION_LIMIT = 20;

export default async function MyCalendarPage({
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

  const supabase = await createClient();
  const [events, notificationResult, numberResult] = await Promise.all([
    getMyEvents(supabase, profile, monthStart, monthEnd),
    supabase
      .from("notifications")
      .select("id, type, title, body, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_LIMIT),
    // 絞り込みチップに出す所属ナンバー。**今月に予定が無いナンバーも出す**
    // (予定を入れ忘れているのか絞り込まれているのか分からなくなるため)
    supabase.from("number_members").select("numbers(id, name)"),
  ]);

  // 今日の予定カードは表示中の月に関わらず「今日」を見る (SPEC §6.4-1)。
  // 今月を見ているなら取得済みの中にあるので、追加のクエリは投げない
  const todayEvents: MyEvent[] =
    today >= monthStart && today <= monthEnd
      ? events.filter((event) => event.date === today)
      : await getMyEvents(supabase, profile, today, today);

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
      read_at: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-2 px-4 py-2">
      <h1 className="sr-only">マイカレンダー</h1>

      {/*
        key を渡して、サーバーが別の日付を返したときに作り直す。
        月送りやブラウザの戻りでクライアント state が取り残されるのを防ぐ
        (useState の初期値は再レンダーでは効かない)。タブ①②と同じ理由。
      */}
      <MyCalendarClient
        key={selectedDate}
        monthAnchor={monthStart}
        initialDate={selectedDate}
        today={today}
        events={events}
        todayEvents={todayEvents}
        notifications={notifications}
        numbers={numbers}
        isOb={profile.role === "ob"}
      />
    </main>
  );
}
