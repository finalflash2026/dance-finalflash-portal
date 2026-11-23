import { NumberDetailClient } from "../../numbers/[id]/NumberDetailClient";
import { DEMO_USER_ID } from "../data";
import { addDays, todayInTokyo } from "@/lib/time";

export default async function DemoNumber({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const asMember = (await searchParams).member === "1";
  const today = todayInTokyo();
  const owner = asMember ? "u9" : DEMO_USER_ID;
  return (
    <NumberDetailClient
      number={{ id: "num-1", name: "秋ナンバー", ownerId: owner }}
      members={[
        { userId: DEMO_USER_ID, username: "22BREAKたろう", generation: 22, mainGenreId: 1, isOb: false },
        { userId: "u9", username: "22POPさくら", generation: 22, mainGenreId: 3, isOb: false },
        { userId: "u2", username: "23LOCKはなこ", generation: 23, mainGenreId: 4, isOb: false },
        { userId: "u4", username: "19JAZZけんた", generation: 19, mainGenreId: 5, isOb: true },
      ]}
      events={[
        { id: "n1", date: today, startTime: "21:00", endTime: "23:00", place: "スタジオA", note: "サビまで通す" },
        { id: "n2", date: addDays(today, 6), startTime: "23:00", endTime: "05:00", place: "スタジオA", note: null },
        { id: "n3", date: addDays(today, 9), startTime: "19:00", endTime: "21:00", place: "練習室2(フレスコ)", note: "通し" },
        { id: "n4", date: addDays(today, 13), startTime: "20:00", endTime: "23:00", place: "スタジオB", note: "動画撮影" },
      ]}
      currentUserId={DEMO_USER_ID}
    />
  );
}
