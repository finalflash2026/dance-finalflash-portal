import { CalendarHome } from "../../(calendar)/CalendarHome";
import { DEMO_USER_ID, demoCalendar } from "../data";
import { demoRound } from "@/lib/scheduling/round";
import { addMonths, endOfMonth, startOfMonth } from "@/lib/time";

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
        rangeStart={startOfMonth(addMonths(data.today, -1))}
        rangeEnd={endOfMonth(addMonths(data.today, 1))}
        initialDate={data.today}
        today={data.today}
        events={data.events}
        blocksByDate={data.blocksByDate}
        numbers={data.numbers}
        genreCodes={data.genreCodes}
        isOb={isOb}
        currentUserId={DEMO_USER_ID}
        upcomingDeadlines={data.upcomingDeadlines}
        keysSummary={isOb ? null : { unlocked: 2, holder: "21HIPHOPじろう" }}
        keysHref="/demo/keys"
        staffHref={isOb ? null : "/demo/coordinator"}
        scheduleRound={isOb ? null : demoRound()}
      />
    </main>
  );
}
