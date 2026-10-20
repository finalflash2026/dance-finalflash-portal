
import { NotificationList } from "@/components/NotificationList";
import { demoCalendar } from "../data";
import { BackButton } from "@/components/BackButton";

export default function DemoNotifications() {
  const data = demoCalendar(false);
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <div>
        <BackButton href="/" label="ホーム" />
      </div>
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
