import { redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import type { StudioPractice } from "@/components/StudioPracticeSection";
import { getCurrentProfile } from "@/lib/auth/session";
import { GENRE_BY_ID } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { normalizeTime, todayInTokyo } from "@/lib/time";

import { NumberCalendarClient } from "./NumberCalendarClient";

/**
 * タブ② ナンバー (SPEC.md §6.3 / §6.3.1)
 *
 * 所属ナンバーの一覧・新規作成と、自分の1ジャンのスタ練の設定。
 *
 * **カレンダーは持たない** (v1.23)。予定を見る場所はマイカレンダーに
 * 一本化した。ここは予定を作る側の画面。
 *
 * 絞り込みはクエリに書いていない。RLS の `sel_numbers` (= is_number_member) と
 * `sel_gpractice` がそのまま効いている。
 */
export default async function NumberTabPage() {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const today = todayInTokyo();
  const isOb = profile.role === "ob";
  const supabase = await createClient();

  const [numbersResult, practicesResult] = await Promise.all([
    supabase
      .from("numbers")
      .select("id, name, owner_id, number_members(user_id)")
      .order("created_at"),
    // スタ練は現役の1ジャンぶんだけ。**過去は出さない** —
    // ここは設定するための画面で、済んだ予定を並べても操作の対象にならない
    isOb
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("genre_practices")
          .select(
            "id, date, start_time, end_time, place, note, created_by, profiles(username)",
          )
          .eq("genre_id", profile.main_genre_id)
          .gte("date", today)
          .order("date"),
  ]);

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

  const practices: StudioPractice[] = (
    (practicesResult.data ?? []) as unknown as {
      id: string;
      date: string;
      start_time: string;
      end_time: string;
      place: string;
      note: string | null;
      created_by: string;
      profiles: { username: string } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    date: row.date,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    place: row.place,
    note: row.note,
    createdBy: row.created_by,
    createdByName: row.profiles?.username ?? "(不明)",
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="sr-only">ナンバー</h1>

      {practicesResult.error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]"
        >
          スタ練の取得に失敗しました: {practicesResult.error.message}
        </p>
      ) : null}

      <NumberCalendarClient
        currentUserId={profile.user_id}
        numbers={numbers}
        numbersError={numbersResult.error?.message ?? null}
        mainGenreCode={
          isOb ? null : (GENRE_BY_ID.get(profile.main_genre_id)?.code ?? null)
        }
        mainGenreId={isOb ? null : profile.main_genre_id}
        practices={practices}
      />
    </main>
  );
}
