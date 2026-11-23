/**
 * 練習場所の鍵のボードに出す部屋 (SPEC.md §6.1.1 / v1.50.4)。
 * サーバー (ページ) とデモの両方から呼ぶので、"use client" のファイルには置かない
 */

/** 今日使う部屋。公式練のコマか、空き申請のあるコマがある部屋 (空いているだけ・使えない部屋は除く) */
export function usedRoomIds(
  slots: { room_id: number; status: string; claims?: unknown[] | null }[],
): number[] {
  return [
    ...new Set(
      slots
        .filter((slot) => slot.status === "genre" || (slot.claims?.length ?? 0) > 0)
        .map((slot) => slot.room_id),
    ),
  ];
}

export interface CarriedRow {
  room_id: number;
  is_unlocked: boolean;
  updated_at: string;
  profiles: { username: string } | null;
}

/** 前日に「開いている」のまま終わり、今日まだ報告の無い部屋 */
export function carriedOpenRows<T extends CarriedRow>(
  yesterday: T[],
  todayRoomIds: number[],
): T[] {
  return yesterday.filter((row) => row.is_unlocked && !todayRoomIds.includes(row.room_id));
}
