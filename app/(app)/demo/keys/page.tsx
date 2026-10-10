import Link from "next/link";

import { ClubKeyBoard } from "@/components/ClubKeyBoard";
import { RoomStatusBoard } from "@/components/RoomStatusBoard";
import { DEMO_USER_ID, demoCalendar } from "../data";

export default function DemoKeys() {
  const data = demoCalendar(false);
  const boards = data.boards!;
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <Link href="/demo/calendar" className="text-[15px] text-[var(--tint)]">
        ‹ ホーム
      </Link>
      <h1 className="text-[28px] font-bold leading-tight">鍵と連絡</h1>
      <RoomStatusBoard
        today={data.today}
        roomIds={[...new Set((data.blocksByDate[data.today] ?? []).map((b) => b.roomId))]}
        initialRows={boards.roomStatusRows}
        initialMessages={boards.roomMessages}
        currentUserId={DEMO_USER_ID}
      />
      <ClubKeyBoard
        initialRows={boards.keyHolderRows}
        currentUserId={DEMO_USER_ID}
        initialMessages={boards.keyMessages}
      />
    </main>
  );
}
