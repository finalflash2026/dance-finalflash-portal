/**
 * デモ画面のダミークライアントが返す見本の行 (SPEC §14.1 / v1.31.13)。
 *
 * 折衝ワークフローはブラウザから直接 Supabase を引くので、画面の見本を
 * 出すにはクライアントの側で行を返す必要がある。**実在の登録者の名前は使わない。**
 *
 * 今月と来月の平日に予約枠を置き、今月は公式練のコマを一部割り当てる
 * (公開済み・下書き・未割り当てが混ざるように)。
 */
import { addDays, addMonths, getWeekday, startOfMonth, todayInTokyo } from "@/lib/time";

type Row = Record<string, unknown>;

const GENRE_ROTATION = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function reservations(): Row[] {
  const rows: Row[] = [];
  const thisMonth = startOfMonth(todayInTokyo());
  for (const [monthIndex, first] of [thisMonth, addMonths(thisMonth, 1)].entries()) {
    for (let d = first; d < addMonths(first, 1); d = addDays(d, 1)) {
      const wd = getWeekday(d);
      if (wd === 0) continue;
      const rooms = wd === 6 ? [6, 9] : [1, 2, 5, 9];
      rooms.forEach((roomId, i) => {
        const id = `r-${d}-${roomId}`;
        const start = wd === 6 ? "13:00" : "17:00";
        const end = wd === 6 ? "18:00" : "21:10";
        // 今月はコマを割り当て済み (前半は公開・後半は下書き)、来月はまだ
        const assigned = monthIndex === 0 && wd !== 6;
        const published = assigned && Number(d.slice(8)) <= 15;
        const genre = GENRE_ROTATION[(Number(d.slice(8)) + i) % GENRE_ROTATION.length];
        rows.push({
          id,
          date: d,
          start_time: `${start}:00`,
          end_time: `${end}:00`,
          room_id: roomId,
          status: "active",
          slots: assigned
            ? [
                {
                  id: `${id}-a`,
                  start_time: "17:00:00",
                  end_time: "18:50:00",
                  status: "genre",
                  genre_id: genre,
                  target_generations: null,
                  published,
                  claims: [],
                },
                {
                  id: `${id}-b`,
                  start_time: "19:10:00",
                  end_time: "21:10:00",
                  status: i === 3 ? "unavailable" : "genre",
                  genre_id: i === 3 ? null : GENRE_ROTATION[(genre + 3) % 9],
                  target_generations: i === 0 ? [23] : null,
                  published,
                  claims: [],
                },
              ]
            : [],
        });
      });
    }
  }
  return rows;
}

const NAMES = ["たろう", "はなこ", "じろう", "さくら", "けんた", "みお", "ゆうき", "あおい", "りく", "ひなた"];
const CODES = ["BREAK", "HIPHOP", "POP", "LOCK", "JAZZ", "HOUSE", "PUNKING", "KRUMP", "GIRLS"];

function profiles(): Row[] {
  const rows: Row[] = [];
  let n = 0;
  for (const generation of [24, 23, 22, 21, 20]) {
    for (let i = 0; i < 6; i++) {
      const genre = (n * 4 + i) % 9;
      const name = NAMES[(n + i) % NAMES.length];
      rows.push({
        user_id: `00000000-0000-0000-0000-${String(1000 + n).padStart(12, "0")}`,
        username: `${generation}${CODES[genre]}${name}`,
        generation,
        main_genre_id: genre + 1,
        display_name: name,
        role:
          generation <= 20
            ? "ob"
            : generation === 22 && i === 0
              ? "admin"
              : generation === 22 && i === 1
                ? "coordinator"
                : "member",
      });
      n++;
    }
  }
  return rows;
}

/** テーブル名 → 見本の行。ここに無いテーブルは空で答える */
export function demoRows(table: string): Row[] {
  if (table === "reservations") return reservations();
  if (table === "profiles") return profiles();
  // ナンバー詳細の出欠表 (v1.35) の見本。/demo/number の日程 n1〜n4 に対応
  if (table === "attendances") {
    return [
      { user_id: "u9", number_event_id: "n1", status: "late", time_value: "21:30:00", reason: "バイト" },
      { user_id: "u2", number_event_id: "n2", status: "absent", time_value: null, reason: "授業" },
      { user_id: "u4", number_event_id: "n3", status: "absent", time_value: null, reason: null },
      { user_id: "u9", number_event_id: "n4", status: "leave_early", time_value: "22:00:00", reason: "用事" },
    ];
  }
  return [];
}
