import { redirect } from "next/navigation";

import { KeysHistory } from "@/components/KeysHistory";
import { RoomStatusBoard, type RoomStatusRow } from "@/components/RoomStatusBoard";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { toBoardMessages } from "@/lib/board-messages";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { carriedOpenRows, usedRoomIds } from "@/lib/room-board";
import { addDays, todayInTokyo } from "@/lib/time";

/**
 * 今日の練習場所の鍵と連絡 (SPEC.md §6.1.1 / §6.1.3)。
 * v1.50.4 で部室の鍵 (/keys/club-key) と別の画面にした。OB は使えない (§3.6)
 */
export default async function RoomKeysPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "ob") redirect("/");

  const today = todayInTokyo();
  const supabase = await createClient();
  const [roomsResult, statusResult, yesterdayResult, messagesResult] = await Promise.all([
    supabase
      .from("slots")
      .select("room_id, status, claims(id)")
      .eq("published", true)
      .eq("date", today),
    supabase
      .from("room_status")
      .select("room_id, is_unlocked, updated_at, profiles(username)")
      .eq("date", today),
    // 前日から開いたままの部屋 (v1.50.4)
    supabase
      .from("room_status")
      .select("room_id, is_unlocked, updated_at, profiles(username)")
      .eq("date", addDays(today, -1))
      .eq("is_unlocked", true),
    supabase
      .from("board_messages")
      .select("id, scope, date, body, user_id, created_at, profiles(username)")
      .eq("scope", "room")
      .eq("date", today)
      .order("created_at", { ascending: true }),
  ]);

  // 出すのは、今日使う部屋・今日報告のあった部屋・前日から開いたままの部屋 (v1.50.4)
  const slots = (roomsResult.data ?? []) as { room_id: number; status: string; claims: unknown[] }[];
  const todayRows = (statusResult.data ?? []) as unknown as RoomStatusRow[];
  const carried = carriedOpenRows(
    (yesterdayResult.data ?? []) as unknown as RoomStatusRow[],
    todayRows.map((row) => row.room_id),
  );

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">練習場所</h1>
      <RoomStatusBoard
        today={today}
        roomIds={[...new Set([...usedRoomIds(slots), ...todayRows.map((row) => row.room_id), ...carried.map((row) => row.room_id)])]}
        initialRows={todayRows}
        carriedRows={carried}
        initialMessages={toBoardMessages(messagesResult.data ?? [])}
        currentUserId={profile.user_id}
      />
      <KeysHistory kind="room" />
    </main>
  );
}
