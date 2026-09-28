/**
 * コマ割り表の組み立て (SPEC.md §6.2 Step2 / v1.28)
 *
 * 折衝係が Excel で作っている表をそのまま画面に持ってくるための計算。
 * **列=練習場所 / 行=日にち×コマ**で、セルの中身は次の5種類:
 *
 *   空欄   その時間にその部屋の予約が無い
 *   ○     予約があって練習できる (まだ何も割り当てていない、または「空き」)
 *   △     予約はあるが、コマの時間を覆いきれていない (時間がズレている)
 *   −     使用不可 (折衝係が塞いだ)
 *   BREAK 公式練 (ジャンル名)
 *
 * ○ を**自動で出す**のがこの表の要点。予約枠 (第1層) とコマの時間を
 * 突き合わせれば機械的に決まるので、折衝係が1つずつ確認する必要がない。
 *
 * ここは React に依存しない純関数だけ置く。画面 (SlotGrid.tsx) と
 * 集計の両方が同じ判定を使うため。
 */

import type { SlotInfo } from "@/lib/slots";
import {
  daysInMonth,
  formatDate,
  getWeekday,
  parseDate,
  toMinutes,
} from "@/lib/time";
import type { DateString, TimeString } from "@/lib/types";

// ---------- コマの時間 ----------

/** 1コマの時間帯。position は 1 から連番 */
export interface SlotPeriod {
  position: number;
  startTime: TimeString;
  endTime: TimeString;
}

/**
 * 「全体の基準」を表す section の値。
 *
 * `slot_periods.section` は NOT NULL にしてある。null を「基準」に使うと、
 * Postgres の一意制約では null 同士が別物として扱われ、基準の行を
 * 何本でも作れてしまう。
 */
export const BASE_SECTION = "";

/**
 * 初期値として置くコマ (SPEC §6.2 Step2-2 / v1.28)。
 *
 * 折衝係が毎月ゼロから打つのは手間なので、いつもの4コマを入れておく。
 * **確定はしない** — 保存するまでは下書きで、月ごとに違ってよい。
 */
export const DEFAULT_PERIODS: readonly SlotPeriod[] = [
  { position: 1, startTime: "13:00", endTime: "14:50" },
  { position: 2, startTime: "15:00", endTime: "16:50" },
  { position: 3, startTime: "17:00", endTime: "19:00" },
  { position: 4, startTime: "19:10", endTime: "21:10" },
];

/** 1つの月のコマ時間。所在ごとの上書きを持てる (まれに1か所だけズレるため) */
export interface PeriodTable {
  base: SlotPeriod[];
  /** section名 → その所在だけのコマ。無ければ base を使う */
  overrides: Map<string, SlotPeriod[]>;
}

export function emptyPeriodTable(): PeriodTable {
  return { base: [...DEFAULT_PERIODS], overrides: new Map() };
}

export function periodsForSection(
  table: PeriodTable,
  section: string,
): SlotPeriod[] {
  return table.overrides.get(section) ?? table.base;
}

/** コマの時間が妥当か。空欄・逆転・重なりを弾く */
export function validatePeriods(periods: SlotPeriod[]): string | null {
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const period of periods) {
    if (!TIME_RE.test(period.startTime) || !TIME_RE.test(period.endTime)) {
      return `${period.position}コマ目の時刻を HH:MM で入れてください`;
    }
    if (toMinutes(period.endTime) <= toMinutes(period.startTime)) {
      return `${period.position}コマ目は終了を開始より後にしてください`;
    }
  }
  const sorted = [...periods].sort(
    (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
  );
  for (let i = 1; i < sorted.length; i += 1) {
    if (toMinutes(sorted[i].startTime) < toMinutes(sorted[i - 1].endTime)) {
      return `${sorted[i - 1].position}コマ目と${sorted[i].position}コマ目の時間が重なっています`;
    }
  }
  return null;
}

/**
 * 保存済みの内容と見比べるための文字列。
 * 「打ったまま保存し忘れた」を画面から言えるようにするために要る
 * (他の折衝係には保存するまで見えないため)。
 */
export function serializePeriodTable(table: PeriodTable): string {
  const parts = [`${BASE_SECTION}:${describe(table.base)}`];
  for (const section of [...table.overrides.keys()].sort()) {
    parts.push(`${section}:${describe(table.overrides.get(section) ?? [])}`);
  }
  return parts.join("|");
}

function describe(periods: SlotPeriod[]): string {
  return periods.map((p) => `${p.startTime}-${p.endTime}`).join(",");
}

// ---------- 日にち ----------

/**
 * その月の練習曜日の日付を並べる (SPEC §6.2 Step2-1)。
 *
 * 公式練は月・水・木にしか入らないので、表の行はこの3曜日で自動的に立てる。
 * 予約が無い日も**行としては出す** — Excel でも空の列を残しておき、
 * 「この日は取れなかった」ことが見えるようにしているため。
 */
export function practiceDatesOfMonth(
  month: DateString,
  weekdays: readonly number[],
): DateString[] {
  const { year, month: monthNumber } = parseDate(month);
  const dates: DateString[] = [];
  for (let day = 1; day <= daysInMonth(year, monthNumber); day += 1) {
    const date = formatDate(year, monthNumber, day);
    if (weekdays.includes(getWeekday(date))) dates.push(date);
  }
  return dates;
}

// ---------- 表のセル ----------

export type GridCellKind =
  | "none"
  | "partial"
  | "unassigned"
  | "open"
  | "unavailable"
  | "genre";

export interface GridCell {
  kind: GridCellKind;
  /** 既にコマがあるなら、その行 */
  slot: SlotInfo | null;
  /** コマを作るときの親。覆っている予約枠が無ければ null */
  reservationId: string | null;
}

/** 基準のコマに合わないコマ。表では表せないので別に並べて知らせる */
export interface OffGridSlot {
  date: DateString;
  roomId: number;
  slot: SlotInfo;
}

export interface GridInput {
  dates: readonly DateString[];
  rooms: readonly { id: number; section: string }[];
  periodsFor: (section: string) => SlotPeriod[];
  reservations: readonly {
    id: string;
    date: DateString;
    startTime: string;
    endTime: string;
    roomId: number;
    slots: SlotInfo[];
  }[];
}

export function cellKey(
  date: DateString,
  roomId: number,
  position: number,
): string {
  return `${date}|${roomId}|${position}`;
}

/**
 * 表の全セルを決める。
 *
 * **覆っているか**の判定は「予約枠がコマを丸ごと含む」こと。
 * 一部しか重なっていない枠では、そのコマの練習はできない
 * (13:00〜14:50 のコマに対して 13:00〜14:00 の予約、など)。
 * ただし黙って空欄にすると気付けないので `partial` として残す —
 * これが「その場所だけ基準の時間とズレている」ことに気付く唯一の手掛かりになる。
 */
export function buildGrid(input: GridInput): {
  cells: Map<string, GridCell>;
  offGrid: OffGridSlot[];
} {
  const byDateRoom = new Map<string, GridInput["reservations"][number][]>();
  for (const reservation of input.reservations) {
    const key = `${reservation.date}|${reservation.roomId}`;
    const list = byDateRoom.get(key);
    if (list) list.push(reservation);
    else byDateRoom.set(key, [reservation]);
  }

  const cells = new Map<string, GridCell>();
  const offGrid: OffGridSlot[] = [];
  const matchedSlotIds = new Set<string>();

  for (const date of input.dates) {
    for (const room of input.rooms) {
      const reservations = byDateRoom.get(`${date}|${room.id}`) ?? [];

      for (const period of input.periodsFor(room.section)) {
        const periodStart = toMinutes(period.startTime);
        const periodEnd = toMinutes(period.endTime);

        const covering = reservations.find(
          (r) =>
            toMinutes(r.startTime) <= periodStart &&
            periodEnd <= toMinutes(r.endTime),
        );
        const touching = reservations.find(
          (r) =>
            toMinutes(r.startTime) < periodEnd &&
            periodStart < toMinutes(r.endTime),
        );

        const slot = reservations
          .flatMap((r) => r.slots)
          .find(
            (s) =>
              toMinutes(s.startTime) === periodStart &&
              toMinutes(s.endTime) === periodEnd,
          );
        if (slot) matchedSlotIds.add(slot.id);

        const key = cellKey(date, room.id, period.position);
        if (slot) {
          cells.set(key, {
            kind:
              slot.status === "genre"
                ? "genre"
                : slot.status === "open"
                  ? "open"
                  : "unavailable",
            slot,
            reservationId: covering?.id ?? null,
          });
        } else if (covering) {
          cells.set(key, {
            kind: "unassigned",
            slot: null,
            reservationId: covering.id,
          });
        } else {
          cells.set(key, {
            kind: touching ? "partial" : "none",
            slot: null,
            reservationId: null,
          });
        }
      }
    }
  }

  // 表のどのセルにも乗らなかったコマ。**黙って隠さない**
  const roomIds = new Set(input.rooms.map((r) => r.id));
  const dateSet = new Set(input.dates);
  for (const reservation of input.reservations) {
    if (!dateSet.has(reservation.date) || !roomIds.has(reservation.roomId)) {
      continue;
    }
    for (const slot of reservation.slots) {
      if (!matchedSlotIds.has(slot.id)) {
        offGrid.push({
          date: reservation.date,
          roomId: reservation.roomId,
          slot,
        });
      }
    }
  }

  return { cells, offGrid };
}

// ---------- 集計 ----------

export interface GridTotals {
  /** 練習できるコマ数 (○ + ジャンル)。使用不可は数えない */
  practicable: number;
  /** その合計時間 (分) */
  minutes: number;
  unassigned: number;
  open: number;
  genre: number;
  unavailable: number;
  partial: number;
  /** ジャンルid → コマ数。均等に配れているかを見る */
  byGenre: Map<number, number>;
}

/**
 * 表の下に出す集計 (SPEC §6.2 Step2-2 / v1.28)。
 *
 * 「この月に何コマ練習できるのか」は、各ジャンルへ配る前に必ず要る数字。
 * ○ の数を折衝係が数えていたので、表から機械的に出す。
 */
export function summarize(
  input: GridInput,
  cells: Map<string, GridCell>,
): GridTotals {
  const totals: GridTotals = {
    practicable: 0,
    minutes: 0,
    unassigned: 0,
    open: 0,
    genre: 0,
    unavailable: 0,
    partial: 0,
    byGenre: new Map(),
  };

  for (const date of input.dates) {
    for (const room of input.rooms) {
      for (const period of input.periodsFor(room.section)) {
        const cell = cells.get(cellKey(date, room.id, period.position));
        if (!cell || cell.kind === "none") continue;

        if (cell.kind === "partial") {
          totals.partial += 1;
          continue;
        }
        if (cell.kind === "unavailable") {
          totals.unavailable += 1;
          continue;
        }

        totals.practicable += 1;
        totals.minutes +=
          toMinutes(period.endTime) - toMinutes(period.startTime);

        if (cell.kind === "genre") {
          totals.genre += 1;
          const id = cell.slot?.genreId;
          if (id != null) {
            totals.byGenre.set(id, (totals.byGenre.get(id) ?? 0) + 1);
          }
        } else if (cell.kind === "open") {
          totals.open += 1;
        } else {
          totals.unassigned += 1;
        }
      }
    }
  }

  return totals;
}

/** 「88時間20分」の形にする。コマ数だけだと長さの違いが見えないため */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}
