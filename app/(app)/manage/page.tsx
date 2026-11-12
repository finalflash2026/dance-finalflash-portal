import { notFound } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { canUseCoordinator } from "@/lib/auth/guard";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { hasSchemaV2 } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayInTokyo } from "@/lib/time";
import type { Announcement, CircleEvent, Deadline } from "@/lib/types";

import { ManageClient } from "./ManageClient";

/**
 * イベント・締切・告知の管理 (SPEC.md §6.7.11 / v1.30)
 *
 * coordinator 以上。権限不足は 404 (§7: 存在を隠す)。告知の欄は admin だけ。
 * ここは表示制御で、認可の実体は RLS (`ins_cevents` など) と
 * `/api/announcements` の requireRole にある (§13.2)。
 *
 * 一覧は**少し前から先**だけを出す。終わったものを全部並べると、
 * これから直したいものが下へ埋もれる。
 */
const PAST_DAYS = 30;

export default async function ManagePage() {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  // イベント・締切・告知の表は 0020 から (v1.49。済んでいない DB では画面ごと出さない)
  if (!canUseCoordinator(profile) || !(await hasSchemaV2())) {
    notFound();
  }

  const supabase = await createClient();
  const since = addDays(todayInTokyo(), -PAST_DAYS);
  const isAdmin = profile!.role === "admin";

  const [eventsResult, deadlinesResult, announcementsResult] = await Promise.all([
    supabase
      .from("circle_events")
      .select("*")
      .gte("end_date", since)
      .order("date", { ascending: true }),
    supabase
      .from("deadlines")
      .select("*")
      .gte("due_date", since)
      .order("due_date", { ascending: true }),
    isAdmin
      ? supabase
          .from("announcements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error =
    eventsResult.error ?? deadlinesResult.error ?? announcementsResult.error;

  return (
    <ManageClient
      currentUserId={profile!.user_id}
      isAdmin={isAdmin}
      today={todayInTokyo()}
      events={(eventsResult.data ?? []) as CircleEvent[]}
      deadlines={(deadlinesResult.data ?? []) as Deadline[]}
      announcements={(announcementsResult.data ?? []) as Announcement[]}
      loadError={error?.message ?? null}
    />
  );
}
