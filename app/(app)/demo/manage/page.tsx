import { ManageClient } from "../../manage/ManageClient";
import { DEMO_USER_ID, demoManage } from "../data";
import { todayInTokyo } from "@/lib/time";

export default function DemoManage() {
  const data = demoManage();
  return (
    <ManageClient
      currentUserId={DEMO_USER_ID}
      isAdmin
      today={todayInTokyo()}
      events={data.events}
      deadlines={data.deadlines}
      announcements={data.announcements}
      loadError={null}
    />
  );
}
