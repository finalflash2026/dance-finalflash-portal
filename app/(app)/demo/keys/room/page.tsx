import { KeysHistory } from "@/components/KeysHistory";
import { RoomStatusBoard } from "@/components/RoomStatusBoard";
import { ROOMS } from "@/lib/constants";
import { usedRoomIds } from "@/lib/room-board";
import { DEMO_USER_ID, demoCalendar } from "../../data";

export default function DemoRoomKeys() {
  const data = demoCalendar(false);
  const boards = data.boards!;
  // 前日から開いたままの部屋の見本 (v1.50.4)。今日使わない部屋を1つ選ぶ
  const used = new Set((data.blocksByDate[data.today] ?? []).filter((b) => b.status !== "unavailable").map((b) => b.roomId));
  const idle = ROOMS.find((room) => !used.has(room.id));
  const carried = idle
    ? [{ room_id: idle.id, is_unlocked: true, updated_at: new Date(Date.now() - 26 * 3600_000).toISOString(), profiles: { username: "24POPさくら" } }]
    : [];
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">練習場所</h1>
      <RoomStatusBoard
        today={data.today}
        roomIds={[...usedRoomIds(
          (data.blocksByDate[data.today] ?? []).map((b) => ({
            room_id: b.roomId,
            status: b.status,
            claims: b.claims,
          })),
        ), ...carried.map((row) => row.room_id)]}
        carriedRows={carried}
        initialRows={boards.roomStatusRows}
        initialMessages={boards.roomMessages}
        currentUserId={DEMO_USER_ID}
      />
      <KeysHistory kind="room" />
    </main>
  );
}
