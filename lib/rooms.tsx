"use client";

import { createContext, useContext, useMemo } from "react";

import { ROOMS as FALLBACK_ROOMS, type Room } from "@/lib/constants";

/**
 * 練習場所の受け渡し (SPEC.md §4.2 / v1.20)
 *
 * **もともとは lib/constants.ts の固定リストだった。** 折衝係が取込画面から
 * 練習場所を足せるようにした以上、コードを直さないと増えない形では
 * 「以降その練習場所を認識する」が成立しない。DB の `rooms` を正とする。
 *
 * **Context にした理由。** 使うのは日別グリッド・申請シート・施錠ボード・
 * 折衝の各画面と広く、しかも階層が深い。props で通すと途中の
 * サーバーコンポーネントまで巻き込んで書き換えることになる。
 * 部屋は全員に同じ値で、リクエスト中に変わらないので Context が素直。
 *
 * 取得は `(app)/layout.tsx` が1回だけ行い、profile の取得と並列に走らせる
 * (往復が増えない)。サーバー側 (API ルート) は DB を直接引くこと。
 */

export type { Room };

const RoomsContext = createContext<readonly Room[] | null>(null);

export function RoomsProvider({
  rooms,
  children,
}: {
  rooms: readonly Room[];
  children: React.ReactNode;
}) {
  return (
    <RoomsContext.Provider value={rooms}>{children}</RoomsContext.Provider>
  );
}

/**
 * 練習場所の一覧 (sort_order 順)。
 *
 * Provider の外で呼ばれたときは**固定リストに落とす**。Supabase 未設定の
 * セットアップ前でも画面が出るようにするためで、落として気付かせる価値より
 * 動くことを優先する場面 (constants 側は初期12件と同じ内容)。
 */
export function useRooms(): readonly Room[] {
  return useContext(RoomsContext) ?? FALLBACK_ROOMS;
}

/** id から引く。存在しない id は undefined */
export function useRoomById(): Map<number, Room> {
  const rooms = useRooms();
  return useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
}

/**
 * 所在 (section) ごとにまとめた並び。
 *
 * **section の一覧も固定で持たない** (v1.20)。南大沢市民センターのように
 * 所在ごと増えることがあるため、部屋の並び順に現れた順で作る。
 */
export function useRoomSections(): { section: string; rooms: Room[] }[] {
  const rooms = useRooms();
  return useMemo(() => groupRoomsBySection(rooms), [rooms]);
}

/** Context を使えない場所 (サーバー側) からも呼べる素の関数 */
export function groupRoomsBySection(
  rooms: readonly Room[],
): { section: string; rooms: Room[] }[] {
  const groups: { section: string; rooms: Room[] }[] = [];
  for (const room of rooms) {
    const last = groups.at(-1);
    if (last && last.section === room.section) last.rooms.push(room);
    else groups.push({ section: room.section, rooms: [room] });
  }
  return groups;
}
