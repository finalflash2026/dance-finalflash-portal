import { CalendarHome } from "../../(calendar)/CalendarHome";
import { DEMO_USER_ID, demoCalendar } from "../data";
import { startOfMonth } from "@/lib/time";

export default async function DemoCalendar({
  searchParams,
}: {
  searchParams: Promise<{ ob?: string }>;
}) {
  const isOb = (await searchParams).ob === "1";
  const data = demoCalendar(isOb);
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-2">
      <CalendarHome
        monthAnchor={startOfMonth(data.today)}
        initialDate={data.today}
        today={data.today}
        events={data.events}
        blocksByDate={data.blocksByDate}
        notifications={data.notifications}
        numbers={data.numbers}
        genreCodes={data.genreCodes}
        isOb={isOb}
        currentUserId={DEMO_USER_ID}
        upcomingDeadlines={data.upcomingDeadlines}
        boards={data.boards}
      />
    </main>
  );
}
