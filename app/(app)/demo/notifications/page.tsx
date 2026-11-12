
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
          {
            id: "nt3",
            type: "announcement",
            title: "鍵の返却について",
            body: "練習のあと、部室の鍵は必ず守衛室に返してください。\n返し忘れが続いているので、最後に出る人が確認してください。",
            createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
            readAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          },
        ]}
      />
    </main>
  );
}
