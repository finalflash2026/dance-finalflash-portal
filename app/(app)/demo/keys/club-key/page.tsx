import { ClubKeyBoard } from "@/components/ClubKeyBoard";
import { DEMO_USER_ID, demoCalendar } from "../../data";

export default function DemoClubKey() {
  const data = demoCalendar(false);
  const boards = data.boards!;
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">部室の鍵</h1>
      <ClubKeyBoard
        initialRows={boards.keyHolderRows}
        currentUserId={DEMO_USER_ID}
        initialMessages={boards.keyMessages}
      />
    </main>
  );
}
