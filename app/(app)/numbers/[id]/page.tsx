import { notFound, redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { normalizeTime } from "@/lib/time";

import { NumberDetailClient } from "./NumberDetailClient";

/**
 * ナンバー詳細: 日程一覧 + メンバー管理 (SPEC.md §6.3 / §7)
 *
 * **非メンバーは 404。** ここでは権限を判定しておらず、RLS の `sel_numbers`
 * (= is_number_member) が非メンバーに対して 0 件を返すので、
 * 「取れなかった = 見せてはいけない」として notFound() に落としている。
 * 存在の有無すら漏らさないための形 (SPEC §7)。
 *
 * このページは (calendar) グループの外にあるので loading 境界より上にあり、
 * notFound() が本当に HTTP 404 を返す。
 */
export default async function NumberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("numbers")
    .select(
      "id, name, owner_id, number_members(user_id, profiles(username, generation, main_genre_id, role)), number_events(id, date, start_time, end_time, place, note)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) {
    notFound();
  }

  const row = data as unknown as {
    id: string;
    name: string;
    owner_id: string;
    number_members: {
      user_id: string;
      profiles: {
        username: string;
        generation: number;
        main_genre_id: number;
        role: string;
      } | null;
    }[] | null;
    number_events: {
      id: string;
      date: string;
      start_time: string;
      end_time: string;
      place: string;
      note: string | null;
    }[] | null;
  };

  return (
    <NumberDetailClient
      number={{ id: row.id, name: row.name, ownerId: row.owner_id }}
      members={(row.number_members ?? []).map((member) => ({
        userId: member.user_id,
        username: member.profiles?.username ?? "(不明)",
        generation: member.profiles?.generation ?? 0,
        mainGenreId: member.profiles?.main_genre_id ?? 0,
        isOb: member.profiles?.role === "ob",
      }))}
      events={(row.number_events ?? [])
        .map((event) => ({
          id: event.id,
          date: event.date,
          startTime: normalizeTime(event.start_time),
          endTime: normalizeTime(event.end_time),
          place: event.place,
          note: event.note,
        }))
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
        )}
      currentUserId={profile.user_id}
    />
  );
}
