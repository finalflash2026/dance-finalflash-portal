/**
 * デモ画面 (`/demo`) の見本データ。**実在の登録者の名前を使わないこと**
 * (SPEC §1 の注意。このリポジトリは公開されている)。
 *
 * 日付は「今日」から組み立てる。いつ開いても今月のカレンダーに見本が並び、
 * 「いま空いている部屋」も出るようにするため。
 */
import type { DayBlock } from "@/components/DayGrid";
import { ROOMS } from "@/lib/constants";
import { demoRound, roundTitle } from "@/lib/scheduling/round";
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

const ROOM_NAMES: Record<number, string> = Object.fromEntries(ROOMS.map((r) => [r.id, r.name]));

const base = { location: "", numberId: null, genreCode: null };
const ev = (
  o: Partial<MyEvent> & Pick<MyEvent, "kind" | "sourceId" | "date" | "title">,
): MyEvent =>
  ({ sourceIds: [o.sourceId], startTime: "18:00", endTime: "19:30", ...base, ...o }) as MyEvent;

/** 日付 → 曜日 (0=日) */
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * 決まった種から 0〜1 を返す (毎回同じ見本になるように。Math.random は使わない)。
 * 日によって空きや他ジャンルの数をばらつかせるのに使う
 */
const pseudo = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

/** 見本を置く範囲 (今日の前後の日数)。カレンダーが読み込む前後1か月を埋める */
const DEMO_SPAN_DAYS = 40;

export function demoCalendar(isOb: boolean) {
  const today = todayInTokyo();
  const d = (n: number) => addDays(today, n);

  const slot = (o: Partial<DayBlock> & Pick<DayBlock, "id" | "roomId" | "startTime" | "endTime" | "status">): DayBlock => ({
    genreCode: null,
    targetGenerations: null,
    note: null,
    claims: [],
    ...o,
  });

  const events: MyEvent[] = [];
  const blocksByDate: Record<string, DayBlock[]> = {};

  /*
   * 毎日の見本 (v1.31.5 で増やした。使い心地を確かめるため)。
   * 自分 = 1ジャン BREAK・2ジャン POP、ナンバーは「秋ナンバー」「縦イベ HIPHOP」。
   */
  for (let n = -DEMO_SPAN_DAYS; n <= DEMO_SPAN_DAYS; n++) {
    const date = d(n);
    const wd = weekday(date);
    const r = (k: number) => pseudo(n * 31 + k);
    const blocks: DayBlock[] = [];

    // ---- 公式練 (平日)。自分のジャンルは自分の予定、他ジャンルは薄く出す用 ----
    if (wd >= 1 && wd <= 5) {
      if (wd === 1 || wd === 3 || wd === 5) {
        const room = wd === 3 ? 1 : 2;
        blocks.push(slot({ id: `g-${n}`, roomId: room, startTime: "18:00", endTime: "19:30", status: "genre", genreCode: "BREAK" }));
        events.push(ev({ kind: "genre", sourceId: `g-${n}`, date, title: "BREAK 公式練", genreCode: "BREAK", location: ROOM_NAMES[room] }));
      }
      if (wd === 2 || wd === 4) {
        blocks.push(slot({ id: `p-${n}`, roomId: 5, startTime: "19:10", endTime: "21:10", status: "genre", genreCode: "POP" }));
        events.push(ev({ kind: "genre", sourceId: `p-${n}`, date, title: "POP 公式練", genreCode: "POP", startTime: "19:10", endTime: "21:10", location: ROOM_NAMES[5] }));
      }
      const others = (["HIPHOP", "LOCK", "JAZZ", "HOUSE", "PUNKING", "KRUMP", "GIRLS"] as const).filter(
        (_, i) => r(i) < 0.45,
      );
      const otherRooms = [3, 4, 9, 10, 11, 12, 1];
      others.forEach((code, i) => {
        const early = r(20 + i) < 0.5;
        blocks.push(
          slot({
            id: `o-${n}-${code}`,
            roomId: otherRooms[i % otherRooms.length],
            startTime: early ? "17:00" : "19:10",
            endTime: early ? "18:50" : "21:10",
            status: "genre",
            genreCode: code,
          }),
        );
      });
    }

    // ---- 空き (控室)。他の人の申請が入っていることもある ----
    if (r(40) < 0.85) {
      const from = wd === 0 || wd === 6 ? "09:00" : "14:00";
      blocks.push(
        slot({
          id: `f136-${n}`, roomId: 6, startTime: from, endTime: "23:50", status: "open",
          claims: r(41) < 0.5
            ? [{ id: `cl136-${n}`, userId: "u2", username: "23LOCKはなこ", startTime: "16:00", endTime: "17:30", purpose: null }]
            : [],
        }),
      );
    }
    if (r(42) < 0.6) {
      blocks.push(slot({ id: `f132-${n}`, roomId: 7, startTime: "09:00", endTime: "21:00", status: "open" }));
    }
    if (r(43) < 0.3) {
      blocks.push(slot({ id: `f131-${n}`, roomId: 8, startTime: "12:00", endTime: "18:00", status: "open" }));
    }

    // ---- 自分の空き使用 (たまに) ----
    if (r(50) < 0.15 && blocks.some((b) => b.id === `f136-${n}`)) {
      events.push(ev({ kind: "claim", sourceId: `c-${n}`, date, title: "空き使用(個人練)", startTime: "20:00", endTime: "21:30", location: ROOM_NAMES[6] }));
    }

    // ---- ナンバー練 ----
    if (wd === 2 || wd === 6) {
      events.push(ev({ kind: "number", sourceId: `n1-${n}`, date, title: "秋ナンバー", numberId: "num-1", startTime: wd === 6 ? "13:00" : "21:00", endTime: wd === 6 ? "16:00" : "23:00", location: "スタジオA" }));
    }
    if (wd === 0 || (wd === 4 && r(60) < 0.5)) {
      events.push(ev({ kind: "number", sourceId: `n2-${n}`, date, title: "縦イベ HIPHOP", numberId: "num-2", startTime: wd === 0 ? "10:00" : "22:00", endTime: wd === 0 ? "12:30" : "24:00", location: wd === 0 ? "アリーナB" : "スタジオC" }));
    }
    if (wd === 5 && r(61) < 0.4) {
      // 深夜練 (日をまたぐ)
      events.push(ev({ kind: "number", sourceId: `n3-${n}`, date, title: "秋ナンバー 深夜練", numberId: "num-1", startTime: "23:00", endTime: "05:00", location: "スタジオA" }));
    }

    // ---- スタ練 (土曜) ----
    if (wd === 6 && r(70) < 0.6) {
      events.push(ev({ kind: "studio", sourceId: `s-${n}`, date, title: "BREAKスタ練", genreCode: "BREAK", startTime: "20:00", endTime: "22:00", location: "スタジオB" }));
    }

    if (blocks.length > 0) blocksByDate[date] = blocks;
  }

  // ---- イベント・締切 (終日) ----
  // 日程調整の締切 (§6.8 / v1.32.2)。カレンダーと近い締切にも出す
  const round = demoRound();
  const deadlineEvents: MyEvent[] = [
    ev({ kind: "deadline", sourceId: "dl-round", date: round.deadline, allDay: true, startTime: "00:00", endTime: "24:00", title: `締切: ${roundTitle(round)}`, important: true, dueTime: "23:59", url: "/schedule?tab=answer" }),
    ev({ kind: "deadline", sourceId: "dl1", date: d(4), allDay: true, startTime: "00:00", endTime: "24:00", title: "締切: 合宿費の集金", important: true, dueTime: "23:59", url: "https://example.com/form" }),
    ev({ kind: "deadline", sourceId: "dl2", date: d(9), allDay: true, startTime: "00:00", endTime: "24:00", title: "締切: 2ジャン登録フォーム", url: "https://example.com/form" }),
    ev({ kind: "deadline", sourceId: "dl3", date: d(1), allDay: true, startTime: "00:00", endTime: "24:00", title: "締切: 学祭の出演アンケート", url: "https://example.com/form" }),
    ev({ kind: "deadline", sourceId: "dl4", date: d(18), allDay: true, startTime: "00:00", endTime: "24:00", title: "締切: 部費の集金", important: true, dueTime: "18:00", url: "https://example.com/form" }),
    ev({ kind: "deadline", sourceId: "dl0", date: d(-6), allDay: true, startTime: "00:00", endTime: "24:00", title: "締切: Tシャツ注文", url: "https://example.com/form" }),
  ];
  const circleEvents: MyEvent[] = [
    ev({ kind: "event", sourceId: "e1", date: d(10), lastDate: d(12), allDay: true, startTime: "00:00", endTime: "24:00", title: "秋合宿", location: "長野" }),
    ev({ kind: "event", sourceId: "e2", date: d(15), title: "縦イベ", startTime: "13:00", endTime: "18:00", location: "講堂" }),
    ev({ kind: "event", sourceId: "e3", date: d(24), lastDate: d(25), allDay: true, startTime: "00:00", endTime: "24:00", title: "学祭", location: "キャンパス" }),
    ev({ kind: "event", sourceId: "e4", date: d(-12), title: "新入生歓迎ショーケース", startTime: "17:00", endTime: "20:00", location: "講堂" }),
    ev({ kind: "event", sourceId: "e5", date: d(7), title: "定例ミーティング", startTime: "12:15", endTime: "13:00", location: "部室" }),
  ];
  events.push(...circleEvents);
  if (!isOb) events.push(...deadlineEvents);

  return {
    today,
    events,
    // OB は縦イベのナンバーと、OB にも見せるイベントだけ (§3.6)
    ...(isOb
      ? { events: events.filter((e) => (e.kind === "number" && e.numberId === "num-2") || e.sourceId === "e2") }
      : {}),
    blocksByDate: isOb ? {} : blocksByDate,
    notifications: [
      {
        id: "nt-round",
        type: "announcement" as const,
        title: `${roundTitle(round)}が始まりました`,
        body: `${round.deadline.slice(5).replace("-", "/")} までに、出られる日を答えてください。ホームの一番上から回答できます。`,
        createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      },
      {
        id: "nt1",
        type: "announcement" as const,
        title: "合宿のしおりを配りました",
        body: "部室の棚に置いてあります。1人1部持っていってください。",
        createdAt: new Date().toISOString(),
      },
      {
        id: "nt3",
        type: "announcement" as const,
        title: "学祭の出演アンケートは明日まで",
        body: "まだの人は今日中にお願いします。",
        createdAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      },
    ],
    numbers: isOb
      ? [{ id: "num-2", name: "縦イベ HIPHOP" }]
      : [
          { id: "num-1", name: "秋ナンバー" },
          { id: "num-2", name: "縦イベ HIPHOP" },
        ],
    genreCodes: isOb ? [] : ["BREAK", "POP"],
    upcomingDeadlines: isOb
      ? []
      : [
          { id: "dl-round", title: roundTitle(round), dueDate: round.deadline, dueTime: "23:59", url: "/schedule?tab=answer", important: true },
          { id: "dl3", title: "学祭の出演アンケート", dueDate: d(1), dueTime: null, url: "https://example.com/form", important: false },
          { id: "dl1", title: "合宿費の集金", dueDate: d(4), dueTime: "23:59", url: "https://example.com/form", important: true },
          { id: "dl2", title: "2ジャン登録フォーム", dueDate: d(9), dueTime: null, url: "https://example.com/form", important: false },
        ].sort((x, y) => x.dueDate.localeCompare(y.dueDate)),
    boards: isOb
      ? null
      : {
          // ホームの入口の「開錠 2部屋」と合わせる
          roomStatusRows: [
            { room_id: 5, is_unlocked: true, updated_at: new Date(Date.now() - 40 * 60_000).toISOString(), profiles: { username: "23LOCKはなこ" } },
            { room_id: 6, is_unlocked: true, updated_at: new Date(Date.now() - 15 * 60_000).toISOString(), profiles: { username: "22BREAKたろう" } },
          ],
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
