import { redirect } from "next/navigation";

import { ClubKeyBoard } from "@/components/ClubKeyBoard";
import { RoomStatusBoard, type RoomStatusRow } from "@/components/RoomStatusBoard";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { toBoardMessages } from "@/lib/board-messages";
import { KEY_HISTORY_LIMIT, toKeyHolderRows } from "@/lib/club-key";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { todayInTokyo } from "@/lib/time";

/**
 * 練習場所の鍵・部室の鍵・連絡 (SPEC.md §6.7.13 / v1.31)
 *
 * ホームを短くするため、施錠ボード (§6.1.1)・部室の鍵 (§6.1.2)・連絡 (§6.1.3) を
 * ここへ移した。ホームには1行の入口だけを置く。OB は使えない (§3.6)。
 */
export default async function KeysPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "ob") redirect("/");

  const today = todayInTokyo();
  const supabase = await createClient();
  const [roomsResult, statusResult, keyResult, messagesResult] = await Promise.all([
    supabase.from("slots").select("room_id").eq("published", true).eq("date", today),
    supabase
      .from("room_status")
      .select("room_id, is_unlocked, updated_at, profiles(username)")
      .eq("date", today),
    supabase
      .from("club_key_holders")
      .select("id, user_id, taken_at, profiles(username)")
      .order("taken_at", { ascending: false })
      .limit(KEY_HISTORY_LIMIT),
    supabase
      .from("board_messages")
      .select("id, scope, date, body, user_id, created_at, profiles(username)")
      .or(`and(scope.eq.room,date.eq.${today}),scope.eq.club_key`)
      .order("created_at", { ascending: true }),
  ]);

  const messageRows = (messagesResult.data ?? []) as unknown as {
    scope: "room" | "club_key";
  }[];

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">鍵と連絡</h1>
      {/* ホームの2枚の入口から、それぞれの欄へ来る (v1.42) */}
      <div id="room" className="scroll-mt-4" />
      <RoomStatusBoard
        today={today}
        roomIds={[
          ...new Set(
            ((roomsResult.data ?? []) as { room_id: number }[]).map((row) => row.room_id),
          ),
        ]}
        initialRows={(statusResult.data ?? []) as unknown as RoomStatusRow[]}
        initialMessages={toBoardMessages(messageRows.filter((row) => row.scope === "room"))}
        currentUserId={profile.user_id}
      />
      <div id="club-key" className="scroll-mt-4" />
      <ClubKeyBoard
        initialRows={toKeyHolderRows(keyResult.data)}
        currentUserId={profile.user_id}
        initialMessages={toBoardMessages(messageRows.filter((row) => row.scope === "club_key"))}
      />
    </main>
  );
}
