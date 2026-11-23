import { RoomStatusBoard } from "@/components/RoomStatusBoard";
import { DEMO_USER_ID, demoCalendar } from "../../data";

export default function DemoRoomKeys() {
  const data = demoCalendar(false);
  const boards = data.boards!;
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">練習場所</h1>
      <RoomStatusBoard
        today={data.today}
        roomIds={[...new Set((data.blocksByDate[data.today] ?? []).map((b) => b.roomId))]}
        initialRows={boards.roomStatusRows}
        initialMessages={boards.roomMessages}
        currentUserId={DEMO_USER_ID}
      />
    </main>
  );
}
