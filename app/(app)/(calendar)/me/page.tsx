import { redirect } from "next/navigation";

import type { NotificationRow } from "@/components/NotificationList";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { GENRE_BY_ID } from "@/lib/constants";
import { getMyEvents, getMyGenreIds } from "@/lib/events";
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

  const isOb = profile.role === "ob";
  const supabase = await createClient();
  const [events, notificationResult, numberResult, genreIds] = await Promise.all([
    getMyEvents(supabase, profile, monthStart, monthEnd),
    // **未読だけを取る** (SPEC §6.4-2 / v1.10)。既読は画面に出さないので、
    // 送ってもハイドレーション用のペイロードに乗るだけで無駄になる
    supabase
      .from("notifications")
      .select("id, type, title, body, created_at")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_LIMIT),
    // 絞り込みチップに出す所属ナンバー。**今月に予定が無いナンバーも出す**
    // (予定を入れ忘れているのか絞り込まれているのか分からなくなるため)
    //
    // **user_id で必ず絞ること。** RLS (`sel_nmembers`) が見せてくれるのは
    // 「自分が所属するナンバーの**全メンバー行**」なので、絞らないと
    // メンバーが3人いるナンバーのチップが3つ並ぶ (v1.12 で修正)。
    supabase
      .from("number_members")
      .select("numbers(id, name)")
      .eq("user_id", profile.user_id),
    // 絞り込みチップに出す自分の1〜3ジャン。**その月に予定が無くても出す**ので
    // 取得済みの予定から逆算はできない (getMyEvents も内部で同じものを引くが、
    // user_subgenres は数行しかなく、揃えるために引数を増やすほうが割に合わない)
    isOb ? Promise.resolve([]) : getMyGenreIds(supabase, profile),
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
    }[]
  ).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
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
        genreCodes={genreIds.flatMap((id) => {
          const code = GENRE_BY_ID.get(id)?.code;
          return code ? [code as string] : [];
        })}
        isOb={isOb}
        currentUserId={profile.user_id}
      />
    </main>
  );
}
