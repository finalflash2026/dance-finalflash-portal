import { NumberCalendarClient } from "../../number-cal/NumberCalendarClient";
import { DEMO_USER_ID } from "../data";
import { addDays, todayInTokyo } from "@/lib/time";

export default function DemoNumbers() {
  const today = todayInTokyo();
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <NumberCalendarClient
        currentUserId={DEMO_USER_ID}
        numbers={[
          { id: "num-1", name: "秋ナンバー", isOwner: true, memberCount: 8 },
          { id: "num-2", name: "縦イベ HIPHOP", isOwner: false, memberCount: 14 },
        ]}
        numbersError={null}
        mainGenreCode="BREAK"
        mainGenreId={1}
        practices={[
          {
            id: "s1", date: addDays(today, 5), startTime: "20:00", endTime: "22:00",
            place: "スタジオB", note: null, targetGenerations: null,
            createdBy: DEMO_USER_ID, createdByName: "22BREAKたろう",
          },
        ]}
        generations={[25, 24, 23, 22]}
      />
    </main>
  );
}
