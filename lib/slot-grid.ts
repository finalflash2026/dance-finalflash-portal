/**
 * コマ割り表の組み立て (SPEC.md §6.2 Step2 / v1.28, v1.29)
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
 * **コマの時間は「日にち×所在」で決まる** (v1.29)。月の基準を1つ置き、
 * 違う日・違う建物だけ上書きする。折衝の実態がそうなっている
 * (施設の都合で、特定の日や特定の建物だけ区切りがずれる)。
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
 * 初期値として置くコマ (SPEC §6.2 Step2-2)。
 *
 * 折衝係が毎月ゼロから打つのは手間なので、よくある4コマを入れておく。
 * **確定はしない** — 保存するまでは下書きで、月ごとに違ってよい。
 */
export const DEFAULT_PERIODS: readonly SlotPeriod[] = [
  { position: 1, startTime: "13:00", endTime: "14:50" },
  { position: 2, startTime: "15:00", endTime: "16:50" },
  { position: 3, startTime: "17:00", endTime: "19:00" },
  { position: 4, startTime: "19:10", endTime: "21:10" },
];

/**
 * 1つの月のコマ時間。
 *
 * `overrides` の鍵は `日付|所在`。**部屋ではなく所在(建物)単位**で持つ —
 * 施設の都合でずれるのは建物ごとで、同じ建物の中の部屋だけ違うことはない。
 */
export interface PeriodTable {
  base: SlotPeriod[];
  overrides: Map<string, SlotPeriod[]>;
}

export function overrideKey(date: DateString, section: string): string {
  return `${date}|${section}`;
}

export function emptyPeriodTable(): PeriodTable {
  return { base: [...DEFAULT_PERIODS], overrides: new Map() };
}

/** その日・その所在で使うコマ。上書きが無ければ月の基準 */
export function periodsFor(
  table: PeriodTable,
  date: DateString,
  section: string,
): SlotPeriod[] {
  return table.overrides.get(overrideKey(date, section)) ?? table.base;
}

export function hasOverride(
  table: PeriodTable,
  date: DateString,
  section: string,
): boolean {
  return table.overrides.has(overrideKey(date, section));
}

/**
 * その日に必要な行数。
 *
 * 上書きした所在だけコマ数が多いことがあるので、**一番多い所に合わせる**。
 * 足りない所在はその行が空欄になる。
 */
export function rowCountForDate(
  table: PeriodTable,
  date: DateString,
  sections: readonly string[],
): number {
  let count = table.base.length;
  for (const section of sections) {
    const override = table.overrides.get(overrideKey(date, section));
    if (override) count = Math.max(count, override.length);
  }
  return count;
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

/** position を 1 から振り直す。消したり足したりしても番号が飛ばないように */
export function renumber(periods: SlotPeriod[]): SlotPeriod[] {
  return periods.map((period, index) => ({ ...period, position: index + 1 }));
}

/**
 * 末尾にコマを1つ足すときの既定値。
 *
 * 直前のコマと同じ長さで、同じだけ間を空けて続ける。
 * 空欄で足すより、たいていの場合そのまま使えるほうが早い。
 */
export function nextPeriod(periods: SlotPeriod[]): SlotPeriod {
  const last = periods[periods.length - 1];
  if (!last) return { ...DEFAULT_PERIODS[0] };

  const length = toMinutes(last.endTime) - toMinutes(last.startTime);
  const previous = periods[periods.length - 2];
  const gap = previous
    ? toMinutes(last.startTime) - toMinutes(previous.endTime)
    : 10;
  const start = toMinutes(last.endTime) + Math.max(gap, 0);
  const end = start + length;
  // 24時を越えるなら足さない側に倒す (日跨ぎはコマ割りでは扱わない)
  if (end > 24 * 60) return { ...last, position: periods.length + 1 };

  return {
    position: periods.length + 1,
    startTime: fromMinutes(start),
    endTime: fromMinutes(end),
  };
}

function fromMinutes(minutes: number): TimeString {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` as TimeString;
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
  | "genre"
  /** この時間に、区切りの合わない古いコマが残っている (v1.29.2) */
  | "conflict";

/** セルの裏に薄く敷く予約の帯。セルの幅に対する％ */
export interface CoverageBar {
  left: number;
  width: number;
}

export interface GridCell {
  kind: GridCellKind;
  /** 既にコマがあるなら、その行 */
  slot: SlotInfo | null;
  /** コマを作るときの親。覆っている予約枠が無ければ null */
  reservationId: string | null;
  /** ①で取り込んだ予約が、このコマのどこを覆っているか */
  coverage: CoverageBar[];
  /**
   * この時間に重なっているが、区切りが一致しないコマ (v1.29.2)。
   *
   * コマの時間を後から変えると必ず出る。**空きに見せてはいけない** —
   * 見た目は ○ なのに、置こうとすると重なりで弾かれることになる。
   */
  overlapping: SlotInfo[];
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
  periodsFor: (date: DateString, section: string) => SlotPeriod[];
  rowCount: (date: DateString) => number;
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
 * ただし黙って空欄にすると気付けないので `partial` として残し、
 * **予約の帯をセルの裏に薄く敷く** (v1.29)。どれだけ足りないのかが
 * 目で分かり、コマの時間をどう直せばよいか決められる。
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
    const rows = input.rowCount(date);
    for (const room of input.rooms) {
      const reservations = byDateRoom.get(`${date}|${room.id}`) ?? [];
      const periods = input.periodsFor(date, room.section);

      for (let index = 0; index < rows; index += 1) {
        const period = periods[index];
        if (!period) continue; // その所在にはこの行のコマが無い

        const periodStart = toMinutes(period.startTime);
        const periodEnd = toMinutes(period.endTime);
        const span = periodEnd - periodStart;

        const covering = reservations.find(
          (r) =>
            toMinutes(r.startTime) <= periodStart &&
            periodEnd <= toMinutes(r.endTime),
        );
        const touching = reservations.some(
          (r) =>
            toMinutes(r.startTime) < periodEnd &&
            periodStart < toMinutes(r.endTime),
        );

        const coverage: CoverageBar[] = [];
        for (const reservation of reservations) {
          const from = Math.max(toMinutes(reservation.startTime), periodStart);
          const to = Math.min(toMinutes(reservation.endTime), periodEnd);
          if (to <= from || span <= 0) continue;
          coverage.push({
            left: ((from - periodStart) / span) * 100,
            width: ((to - from) / span) * 100,
          });
        }

        const roomSlots = reservations.flatMap((r) => r.slots);
        const slot = roomSlots.find(
          (s) =>
            toMinutes(s.startTime) === periodStart &&
            toMinutes(s.endTime) === periodEnd,
        );
        if (slot) matchedSlotIds.add(slot.id);

        // ぴったり一致はしないが、この時間に重なっているコマ。
        // コマの時間を後から変えると出る (前の区切りで作ったコマが残る)
        const overlapping = slot
          ? []
          : roomSlots.filter(
              (s) =>
                toMinutes(s.startTime) < periodEnd &&
                periodStart < toMinutes(s.endTime),
            );

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
            coverage,
            overlapping: [],
          });
        } else if (overlapping.length > 0) {
          // **○ にしない。** 空きに見えるのに置こうとすると重なりで弾かれる
          cells.set(key, {
            kind: "conflict",
            slot: null,
            reservationId: covering?.id ?? null,
            coverage,
            overlapping,
          });
        } else if (covering) {
          cells.set(key, {
            kind: "unassigned",
            slot: null,
            reservationId: covering.id,
            coverage,
            overlapping: [],
          });
        } else {
          cells.set(key, {
            kind: touching ? "partial" : "none",
            slot: null,
            reservationId: null,
            coverage,
            overlapping: [],
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
  /** 区切りの合わない古いコマが残っているセル (v1.29.2) */
  conflict: number;
  /** ジャンルid → コマ数。均等に配れているかを見る */
  byGenre: Map<number, number>;
}

/**
 * 表の下に出す集計 (SPEC §6.2 Step2-2)。
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
    conflict: 0,
    byGenre: new Map(),
  };

  for (const date of input.dates) {
    const rows = input.rowCount(date);
    for (const room of input.rooms) {
      const periods = input.periodsFor(date, room.section);
      for (let index = 0; index < rows; index += 1) {
        const period = periods[index];
        if (!period) continue;

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
        // 練習はできる時間なので数には入れるが、古いコマが残っていて
        // そのままでは置けない。別に数えて画面で片付けさせる
        if (cell.kind === "conflict") {
          totals.practicable += 1;
          totals.minutes +=
            toMinutes(period.endTime) - toMinutes(period.startTime);
          totals.conflict += 1;
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
