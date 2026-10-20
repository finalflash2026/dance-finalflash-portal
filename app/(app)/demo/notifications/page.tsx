
import { NotificationList } from "@/components/NotificationList";
import { demoCalendar } from "../data";

export default function DemoNotifications() {
  const data = demoCalendar(false);
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">お知らせ</h1>
      <NotificationList
        fullHeight
        initial={[
          ...data.notifications,
          {
            id: "nt2",
            type: "schedule_updated",
            title: "11月の練習日程が公開されました",
            body: null,
            createdAt: new Date(Date.now() - 86_400_000).toISOString(),
          },
        ]}
      />
    </main>
  );
}
