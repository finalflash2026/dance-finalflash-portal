import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ROOMS as FALLBACK_ROOMS, type Room } from "@/lib/constants";

/**
 * 練習場所をDBから引く (SPEC.md §4.2 / v1.20)
 *
 * 画面側は `lib/rooms.tsx` の `useRooms()` を使う。こちらは
 * レイアウトと API ルート、つまり**サーバー側の入口**用。
 *
 * 部屋が増えるのは年に数回で、しかも全員に同じ値なので、
 * 素直に毎回引く。`(app)/layout.tsx` では profile の取得と並列に走らせて
 * いるため、往復は増えていない。
 */
export async function fetchRooms(
  supabase: SupabaseClient,
): Promise<readonly Room[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, name, section, sort_order")
    .order("sort_order");

  // **落とさない。** 部屋が引けないだけで画面全体を出せなくするより、
  // 初期12件で描いておくほうが被害が小さい (増えたぶんが出ないだけ)
  if (error || !data) {
    console.error("[rooms] 引けませんでした", error?.message);
    return FALLBACK_ROOMS;
  }

  return (data as { id: number; name: string; section: string; sort_order: number }[]).map(
    (row) => ({
      id: row.id,
      name: row.name,
      section: row.section,
      sortOrder: row.sort_order,
    }),
  );
}

/** id → Room。API ルートでの存在確認に使う */
export async function fetchRoomMap(
  supabase: SupabaseClient,
): Promise<Map<number, Room>> {
  const rooms = await fetchRooms(supabase);
  return new Map(rooms.map((room) => [room.id, room]));
}
