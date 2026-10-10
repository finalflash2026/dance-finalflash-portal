/**
 * デモ画面 (`/demo`) の見本データ。**実在の登録者の名前を使わないこと**
 * (SPEC §1 の注意。このリポジトリは公開されている)。
 *
 * 日付は「今日」から組み立てる。いつ開いても今月のカレンダーに見本が並び、
 * 「いま空いている部屋」も出るようにするため。
 */
import type { DayBlock } from "@/components/DayGrid";
import { addDays, todayInTokyo } from "@/lib/time";
import type {
  Announcement,
  CircleEvent,
  Deadline,
  MyEvent,
  Profile,
} from "@/lib/types";

export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

export function demoProfile(role: Profile["role"] = "admin"): Profile {
  return {
    user_id: DEMO_USER_ID,
    username: "22BREAKたろう",
    generation: 22,
    main_genre_id: 1,
    display_name: "たろう",
    role,
    created_at: "2026-04-01T00:00:00Z",
  };
}

const base = { location: "", numberId: null, genreCode: null };
const ev = (
  o: Partial<MyEvent> & Pick<MyEvent, "kind" | "sourceId" | "date" | "title">,
): MyEvent =>
  ({ sourceIds: [o.sourceId], startTime: "18:00", endTime: "19:30", ...base, ...o }) as MyEvent;

export function demoCalendar(isOb: boolean) {
  const today = todayInTokyo();
  const d = (n: number) => addDays(today, n);

  const events: MyEvent[] = [
    ...(isOb
      ? []
      : [
          ev({ kind: "genre", sourceId: "g1", date: today, title: "BREAK 公式練", genreCode: "BREAK", location: "練習室1(フレスコ)" }),
          ev({ kind: "genre", sourceId: "g2", date: d(2), title: "BREAK 公式練", genreCode: "BREAK", startTime: "17:00", endTime: "19:00", location: "スタジオ101(7号館)" }),
          ev({ kind: "genre", sourceId: "g3", date: d(3), title: "POP 公式練", genreCode: "POP", startTime: "19:10", endTime: "21:10", location: "リハーサル室" }),
          ev({ kind: "claim", sourceId: "c1", date: d(1), title: "空き使用(個人練)", startTime: "13:00", endTime: "14:30", location: "控室136" }),
          ev({ kind: "studio", sourceId: "s1", date: d(5), title: "BREAKスタ練", genreCode: "BREAK", startTime: "20:00", endTime: "22:00", location: "スタジオB" }),
          ev({ kind: "deadline", sourceId: "dl1", date: d(4), allDay: true, startTime: "00:00", endTime: "24:00", title: "締切: 合宿費の集金", important: true, dueTime: "23:59", url: "https://example.com/form" }),
          ev({ kind: "deadline", sourceId: "dl2", date: d(9), allDay: true, startTime: "00:00", endTime: "24:00", title: "締切: 2ジャン登録フォーム", url: "https://example.com/form" }),
        ]),
    ev({ kind: "number", sourceId: "n1", date: today, title: "秋ナンバー", numberId: "num-1", startTime: "21:00", endTime: "23:00", location: "スタジオA" }),
    ev({ kind: "number", sourceId: "n2", date: d(6), title: "秋ナンバー", numberId: "num-1", startTime: "23:00", endTime: "05:00", location: "スタジオA" }),
    ev({ kind: "event", sourceId: "e1", date: d(10), lastDate: d(12), allDay: true, startTime: "00:00", endTime: "24:00", title: "秋合宿", location: "長野" }),
    ...(isOb
      ? [ev({ kind: "event", sourceId: "e2", date: d(15), title: "縦イベ", startTime: "13:00", endTime: "18:00", location: "講堂" })]
      : [ev({ kind: "event", sourceId: "e2", date: d(15), title: "縦イベ", startTime: "13:00", endTime: "18:00", location: "講堂" })]),
  ];

  const slot = (o: Partial<DayBlock> & Pick<DayBlock, "id" | "roomId" | "startTime" | "endTime" | "status">): DayBlock => ({
    genreCode: null,
    targetGenerations: null,
    note: null,
    claims: [],
    ...o,
  });
  const todayBlocks: DayBlock[] = [
    slot({ id: "g1", roomId: 2, startTime: "18:00", endTime: "19:30", status: "genre", genreCode: "BREAK" }),
    slot({ id: "o1", roomId: 3, startTime: "18:00", endTime: "19:30", status: "genre", genreCode: "HIPHOP" }),
    slot({ id: "o2", roomId: 5, startTime: "17:00", endTime: "19:00", status: "genre", genreCode: "JAZZ" }),
    slot({ id: "o3", roomId: 9, startTime: "19:10", endTime: "21:10", status: "genre", genreCode: "LOCK" }),
    slot({
      id: "f1", roomId: 6, startTime: "00:00", endTime: "23:50", status: "open",
      claims: [{ id: "cl1", userId: "u2", username: "23LOCKはなこ", startTime: "13:00", endTime: "14:00", purpose: null }],
    }),
    slot({ id: "f2", roomId: 7, startTime: "09:00", endTime: "21:00", status: "open" }),
    slot({ id: "u1", roomId: 8, startTime: "09:00", endTime: "12:00", status: "unavailable" }),
  ];

  return {
    today,
    events,
    blocksByDate: isOb ? {} : { [today]: todayBlocks },
    notifications: [
      {
        id: "nt1",
        type: "announcement" as const,
        title: "合宿のしおりを配りました",
        body: "部室の棚に置いてあります。1人1部持っていってください。",
        createdAt: new Date().toISOString(),
      },
    ],
    numbers: [{ id: "num-1", name: "秋ナンバー" }],
    genreCodes: isOb ? [] : ["BREAK", "POP"],
    upcomingDeadlines: isOb
      ? []
      : [
          { id: "dl1", title: "合宿費の集金", dueDate: d(4), dueTime: "23:59", url: "https://example.com/form", important: true },
          { id: "dl2", title: "2ジャン登録フォーム", dueDate: d(9), dueTime: null, url: "https://example.com/form", important: false },
        ],
    boards: isOb
      ? null
      : {
          roomStatusRows: [],
          roomMessages: [
            { id: "m1", body: "控室136は開けていないけど、鍵はリハ室にいる人が持ってます", userId: "u2", username: "23LOCKはなこ", createdAt: new Date().toISOString() },
          ],
          keyHolderRows: [
            { id: "k1", userId: "u3", username: "21HIPHOPじろう", takenAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
          ],
          keyMessages: [],
        },
  };
}

export function demoManage(): {
  events: CircleEvent[];
  deadlines: Deadline[];
  announcements: Announcement[];
} {
  const today = todayInTokyo();
  const d = (n: number) => addDays(today, n);
  const meta = { created_by: DEMO_USER_ID, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  return {
    events: [
      { id: "e1", title: "秋合宿", date: d(10), end_date: d(12), start_time: null, end_time: null, place: "長野", note: null, show_to_ob: false, ...meta },
      { id: "e2", title: "縦イベ", date: d(15), end_date: d(15), start_time: "13:00", end_time: "18:00", place: "講堂", note: "OB/OGと合同", show_to_ob: true, ...meta },
    ],
    deadlines: [
      { id: "dl1", title: "合宿費の集金", due_date: d(4), due_time: "23:59", url: "https://example.com/form", note: null, important: true, ...meta },
      { id: "dl2", title: "2ジャン登録フォーム", due_date: d(9), due_time: null, url: "https://example.com/form", note: null, important: false, ...meta },
    ],
    announcements: [
      { id: "a1", title: "合宿のしおりを配りました", body: "部室の棚に置いてあります。1人1部持っていってください。", include_ob: false, created_by: DEMO_USER_ID, created_at: new Date().toISOString() },
    ],
  };
}
