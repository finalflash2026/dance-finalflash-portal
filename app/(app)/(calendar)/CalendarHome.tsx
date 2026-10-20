"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  AttendanceSheet,
  type AttendanceTarget,
} from "@/components/AttendanceSheet";
import { ClaimSheet } from "@/components/ClaimSheet";
import { DayGrid, type DayBlock } from "@/components/DayGrid";
import { DayTimeline, type TimelineEvent } from "@/components/DayTimeline";
import { LabelCalendar } from "@/components/LabelCalendar";
import { Sheet } from "@/components/Sheet";
import {
  GroupHeader,
  ImportantBadge,
  Segmented,
  Switch,
  fillButtonClass,
  groupClass,
  primaryButtonClass,
} from "@/components/ui";
import { freeRanges, type TimeRange } from "@/lib/claims";
import {
  GENRES,
  GENRE_COLORS,
  SLOT_OPEN_COLOR,
  type GenreCode,
} from "@/lib/constants";
import { spanNote } from "@/lib/day-span";
import { eventColor, expandMyEvents } from "@/lib/event-display";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_LAYOUT_EVENT,
  readHomeLayout,
  type HomeLayout,
  type HomeSection,
} from "@/lib/home-layout";
import { useRoomById } from "@/lib/rooms";
import {
  CLAIM_STEP_MINUTES,
  addDays,
  formatDateLabel,
  fromMinutes,
  getWeekday,
  nowTimeInTokyo,
  parseDate,
  startOfMonth,
  toMinutes,
} from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/**
 * ホーム (SPEC.md §6.7.13 / v1.31)
 *
 * 既定の並び (v1.31.8): 1週間の帯 (押すと月表示) + 選んだ日の予定 →
 *             近い締切 → 今日自主練できる部屋 → 鍵まわりの入口
 * 並びと表示/非表示は設定の「ホームの並び」で変えられる (v1.31.6)。
 * 今日の予定は、開いた直後に今日を選んでいる「選んだ日の予定」で見る
 * (以前は上に「今日」の欄があり、同じ予定を2回出していた)。
 *
 * **開いてすぐ見たいものだけを置く。** 鍵のボードは /keys、お知らせはベルへ。
 *
 * 週の帯は横スクロール + スナップで動かす。慣性の動きを端末そのものに任せると、
 * 自前でなぞるより iPhone の標準に近く、なめらかに感じる。
 */

const FILTER_STORAGE_KEY = "calendar-filter-v2";
const VIEW_STORAGE_KEY = "calendar-day-view-v2";

export interface UpcomingDeadline {
  id: string;
  title: string;
  dueDate: DateString;
  dueTime: string | null;
  url: string | null;
  important: boolean;
}

export interface KeysSummary {
  /** 今日開錠済みの練習場所の数 */
  unlocked: number;
  /** 部室の鍵を今持っている人 */
  holder: string | null;
}

/**
 * 絞り込み (§6.7.13)。**既定は自分の予定だけ**で、他ジャンルの公式練と空きを足していく。
 * 自分の予定とイベント・締切は常に出る。
 */
interface Filter {
  genres: string[];
  free: boolean;
}
const DEFAULT_FILTER: Filter = { genres: [], free: false };

type DayView = "list" | "time" | "rooms";

export function CalendarHome({
  rangeStart,
  rangeEnd,
  initialDate,
  today,
  events,
  blocksByDate,
  genreCodes,
  isOb,
  currentUserId,
  upcomingDeadlines,
  keysSummary,
  keysHref = "/keys",
}: {
  /** 読み込んである範囲 (表示中の月の前後1か月) */
  rangeStart: DateString;
  rangeEnd: DateString;
  initialDate: DateString;
  today: DateString;
  events: MyEvent[];
  /** 範囲 (と今日) の公開済みコマ。OB は空 */
  blocksByDate: Record<DateString, DayBlock[]>;
  /** 所属ナンバー (今は使っていないが、ページ側の取得と揃えておく) */
  numbers?: { id: string; name: string }[];
  /** 自分の1〜3ジャン */
  genreCodes: string[];
  isOb: boolean;
  currentUserId: string;
  upcomingDeadlines: UpcomingDeadline[];
  /** 鍵の入口の要約 (現役のみ。OB は null) */
  keysSummary: KeysSummary | null;
  /** 鍵の入口の行き先。デモ画面 (/demo) だけ差し替える */
  keysHref?: string;
}) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(initialDate);
  /** 日を変えた向き。中身を滑らせて入れ替えるのに使う */
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [filter, setFilter] = useState<Filter>(DEFAULT_FILTER);
  const [dayView, setDayView] = useState<DayView>("list");
  const [monthOpen, setMonthOpen] = useState(false);
  const [layout, setLayout] = useState<HomeLayout>(DEFAULT_HOME_LAYOUT);
  const [selected, setSelected] = useState<MyEvent | null>(null);
  const [claiming, setClaiming] = useState<{
    date: DateString;
    slot: DayBlock;
    range: TimeRange;
  } | null>(null);

  // 端末に保存した選択は、描画後に読む (サーバーでは読めないため)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? "null");
      if (saved && Array.isArray(saved.genres)) {
        setFilter({ genres: saved.genres, free: Boolean(saved.free) });
      }
      const view = localStorage.getItem(VIEW_STORAGE_KEY);
      if (view === "time" || (view === "rooms" && !isOb)) setDayView(view);
    } catch {}
  }, [isOb]);

  // ホームの並びも端末に保存してある。設定で変えたら同じタブでも追いかける
  useEffect(() => {
    const load = () => setLayout(readHomeLayout());
    load();
    window.addEventListener(HOME_LAYOUT_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(HOME_LAYOUT_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  function changeFilter(next: Filter) {
    setFilter(next);
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  function changeView(view: DayView) {
    setDayView(view);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {}
  }

  function selectDate(date: DateString) {
    if (date === selectedDate) return;
    // 読み込んだ範囲の外はページごと読み直す (その日を中心に前後1か月)
    if (date < rangeStart || date > rangeEnd) {
      router.push(`/?date=${encodeURIComponent(date)}`);
      return;
    }
    setDirection(date > selectedDate ? "right" : "left");
    setSelectedDate(date);
    window.history.replaceState(
      null,
      "",
      date === today ? window.location.pathname : `?date=${encodeURIComponent(date)}`,
    );
  }

  // **日をまたぐ深夜練・複数日のイベントは日ごとに割る** (v1.21 / v1.30)。
  // 同じ日の中は終日を先頭に、あとは開始時刻順
  const entries = useMemo(() => sortEntries(expandMyEvents(events)), [events]);

  const eventsByDate = useMemo(() => {
    const map = new Map<DateString, MyEvent[]>();
    for (const entry of entries) {
      const list = map.get(entry.date) ?? [];
      list.push(entry.event);
      map.set(entry.date, list);
    }
    return map;
  }, [entries]);

  // 自分の公式練として既に出ているコマ。「ほかの練習」から外す
  const mySlotIds = useMemo(
    () =>
      new Set(events.filter((event) => event.kind === "genre").flatMap((e) => e.sourceIds)),
    [events],
  );

  const todayBlocks = blocksByDate[today] ?? [];
  const dayBlocks = blocksByDate[selectedDate] ?? [];
  const otherGenres = GENRES.map((g) => g.code as string).filter(
    (code) => !genreCodes.includes(code),
  );

  // 欄の中身。並びと表示/非表示は設定の「ホームの並び」で変える (v1.31.6)
  const sections: Record<HomeSection, React.ReactNode> = {
    deadlines: isOb ? null : <DeadlinesSection today={today} deadlines={upcomingDeadlines} />,
    freeRooms: isOb ? null : (
      <FreeRoomsToday
        blocks={todayBlocks}
        onClaim={(slot, range) => setClaiming({ date: today, slot, range })}
      />
    ),
    keys: keysSummary ? <KeysEntry summary={keysSummary} href={keysHref} /> : null,
    calendar: (
      <>
        <section className="space-y-3" data-tour="calendar">
          <CalendarHeader
            selectedDate={selectedDate}
            today={today}
            monthOpen={monthOpen}
            onToday={() => selectDate(today)}
            onToggleMonth={() => setMonthOpen((open) => !open)}
            viewSwitch={
              <Segmented
                label="表示のしかた"
                value={dayView}
                onChange={changeView}
                size="large"
                options={[
                  { value: "list", label: "一覧" },
                  { value: "time", label: "時間" },
                  ...(isOb ? [] : [{ value: "rooms" as const, label: "部屋" }]),
                ]}
              />
            }
            filterButton={
              isOb ? null : (
                <FilterButton filter={filter} otherGenres={otherGenres} onChange={changeFilter} />
              )
            }
          />

          {/*
            週の帯と月表示は、高さをなめらかに伸び縮みさせて切り替える
            (grid の 0fr ↔ 1fr。高さを数えずに中身なりで動かせる)
          */}
          {/* 2つの箱を1つにまとめる。閉じている方にも space-y の隙間が付き、帯と予定の間が空いた */}
          <div>
            <Collapse open={!monthOpen}>
              <WeekStrip
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                selectedDate={selectedDate}
                today={today}
                eventsByDate={eventsByDate}
                onSelect={selectDate}
              />
            </Collapse>
            <Collapse open={monthOpen}>
              <LabelCalendar
                basePath="/"
                monthAnchor={startOfMonth(selectedDate)}
                selectedDate={selectedDate}
                today={today}
                eventsByDate={eventsByDate}
                onSelectDate={(date) => {
                  selectDate(date);
                  setMonthOpen(false);
                }}
              />
            </Collapse>
          </div>
        </section>

        <section data-tour="day">
          {/* 日を変えたら、滑らせた向きに合わせて中身を少しずらして入れ替える */}
          <div
            key={`${selectedDate}-${dayView}`}
            className={
              direction === "right" ? "page-in-right" : direction === "left" ? "page-in-left" : ""
            }
          >
            {dayView === "rooms" && !isOb ? (
              <DayGrid date={selectedDate} blocks={dayBlocks} currentUserId={currentUserId} />
            ) : (
              <DayContent
                date={selectedDate}
                today={today}
                view={dayView === "time" ? "time" : "list"}
                mine={entries.filter((entry) => entry.date === selectedDate)}
                blocks={dayBlocks}
                filter={filter}
                mySlotIds={mySlotIds}
                onSelect={setSelected}
                onClaim={(slot, range) => setClaiming({ date: selectedDate, slot, range })}
              />
            )}
          </div>
        </section>
      </>
    ),
  };

  return (
    <>
      {layout.order
        .filter((key) => !layout.hidden.includes(key))
        .map((key) => <Fragment key={key}>{sections[key]}</Fragment>)}

      {selected && (selected.kind === "event" || selected.kind === "deadline") ? (
        <EventDetailSheet event={selected} onClose={() => setSelected(null)} />
      ) : null}
      {selected && selected.kind !== "event" && selected.kind !== "deadline" ? (
        <AttendanceSheet
          target={attendanceTarget(selected)}
          title={selected.title}
          date={selected.date}
          startTime={selected.startTime}
          endTime={selected.endTime}
          location={selected.location}
          currentUserId={currentUserId}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {claiming ? (
        <ClaimSheet
          date={claiming.date}
          slot={claiming.slot}
          initialRange={claiming.range}
          roomBlocks={(blocksByDate[claiming.date] ?? []).filter(
            (block) => block.roomId === claiming.slot.roomId,
          )}
          currentUserId={currentUserId}
          onClose={() => setClaiming(null)}
        />
      ) : null}
    </>
  );
}

type Entry = ReturnType<typeof expandMyEvents>[number];

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const wholeA = isWholeDayEntry(a);
    const wholeB = isWholeDayEntry(b);
    if (wholeA !== wholeB) return wholeA ? -1 : 1;
    return a.startTime.localeCompare(b.startTime);
  });
}

/** 終日の予定か、複数日イベントの中日 (その日は丸1日) */
function isWholeDayEntry(entry: { event: MyEvent; startTime: string; endTime: string }): boolean {
  return (
    Boolean(entry.event.allDay) || (entry.startTime === "00:00" && entry.endTime === "24:00")
  );
}

/** 空き申請は出欠の対象外なので情報表示だけにする (§6.4.2) */
function attendanceTarget(event: MyEvent): AttendanceTarget {
  if (event.kind === "genre") {
    return { kind: "slot", id: event.sourceId, ids: event.sourceIds };
  }
  if (event.kind === "number") {
    return { kind: "numberEvent", id: event.sourceId };
  }
  if (event.kind === "studio") {
    const genreId = GENRES.find((g) => g.code === event.genreCode)?.id;
    if (genreId !== undefined) {
      return { kind: "studioPractice", id: event.sourceId, genreId };
    }
  }
  return { kind: "info" };
}

/** 選んだ日の一覧に最初から出す件数 (§6.7.13 / v1.31.1 → v1.31.6)。残りは折りたたむ */
const DAY_VISIBLE = 3;

// ---------- 近い締切 (§6.7.13 / v1.31.6) ----------

/** 近い締切の欄に出す件数 */
const DEADLINES_VISIBLE = 3;

/**
 * 近い締切。以前は「今日」の欄に予定と一緒に入れていたが、「今日」は
 * カレンダーの選んだ日の予定にまとめたので (v1.31.6)、締切だけで1つの欄にする
 */
function DeadlinesSection({
  today,
  deadlines,
}: {
  today: DateString;
  deadlines: UpcomingDeadline[];
}) {
  if (deadlines.length === 0) return null;
  return (
    <section data-tour="deadlines">
      <GroupHeader>近い締切</GroupHeader>
      <ul className={groupClass}>
        {deadlines.slice(0, DEADLINES_VISIBLE).map((deadline) => (
          <DeadlineRow key={deadline.id} deadline={deadline} today={today} />
        ))}
      </ul>
    </section>
  );
}

function DeadlineRow({ deadline, today }: { deadline: UpcomingDeadline; today: DateString }) {
  const days = daysBetween(today, deadline.dueDate);
  const inner = (
    <>
      <span aria-hidden className="h-9 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
      <span
        className={`w-[92px] shrink-0 text-[14px] font-semibold tabular-nums ${
          days <= 1 ? "text-[var(--danger-solid)]" : "text-[var(--muted)]"
        }`}
      >
        〆 {days === 0 ? "今日" : days === 1 ? "明日" : `あと${days}日`}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[16px]">
          {deadline.important ? <ImportantBadge /> : null}
          <span className="truncate">{deadline.title}</span>
        </span>
        <span className="block text-[13px] text-[var(--muted)]">
          {formatDateLabel(deadline.dueDate)}
          {deadline.dueTime ? ` ${deadline.dueTime}まで` : ""}
        </span>
      </span>
      {deadline.url ? <span className="shrink-0 text-[15px] text-[var(--tint)]">開く</span> : null}
    </>
  );
  return (
    <li>
      {deadline.url ? (
        <a
          href={deadline.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-2.5"
        >
          {inner}
        </a>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>
      )}
    </li>
  );
}

function daysBetween(from: DateString, to: DateString): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

// ---------- 今日自主練できる部屋 (§6.7.13) ----------

function FreeRoomsToday({
  blocks,
  onClaim,
}: {
  blocks: DayBlock[];
  onClaim: (slot: DayBlock, range: TimeRange) => void;
}) {
  const roomById = useRoomById();
  // サーバーとブラウザで時刻がずれるので、描画後に読む (ハイドレーション対策)
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    setNow(nowTimeInTokyo());
    const timer = window.setInterval(() => setNow(nowTimeInTokyo()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (now === null) return null;
  const nowMinutes = toMinutes(now);
  // 申請は10分単位なので、今から使うときの開始は今を10分単位に切り上げた時刻
  const nowStep = Math.ceil(nowMinutes / CLAIM_STEP_MINUTES) * CLAIM_STEP_MINUTES;

  const rows = blocks
    .filter((block) => block.status === "open")
    .flatMap((block) =>
      freeRanges(block, block.claims).flatMap((range) => {
        const start = Math.max(toMinutes(range.startTime), nowStep);
        // 終わった時間帯と、刻み1つぶんも残っていないものは出さない
        if (toMinutes(range.endTime) - start < CLAIM_STEP_MINUTES) return [];
        return [
          {
            block,
            range: { startTime: fromMinutes(start), endTime: range.endTime },
            current: toMinutes(range.startTime) <= nowMinutes,
          },
        ];
      }),
    )
    .sort((a, b) => a.range.startTime.localeCompare(b.range.startTime));

  if (rows.length === 0) return null;

  return (
    <section data-tour="free-rooms">
      <GroupHeader>今日自主練できる部屋</GroupHeader>
      {/*
       * 横に並ぶチップ (v1.31.5)。縦の行だと部屋が増えるほど下のカレンダーが
       * 遠のく。入りきらない分は折り返す。押すと申請シート
       */}
      <ul className="flex flex-wrap gap-2">
        {rows.map(({ block, range, current }) => (
          <li key={`${block.id}-${range.startTime}`}>
            <button
              type="button"
              onClick={() => onClaim(block, range)}
              aria-label={`${roomById.get(block.roomId)?.name ?? "?"} ${range.startTime}〜${range.endTime} を申請`}
              className="flex items-center gap-1.5 rounded-full bg-[var(--cell)] py-1.5 pl-2.5 pr-3 text-left active:opacity-60"
            >
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  current ? "bg-[#34c759]" : "bg-[var(--muted)] opacity-50"
                }`}
              />
              <span className="text-[14px] font-semibold">
                {roomById.get(block.roomId)?.name ?? "?"}
              </span>
              <span className="text-[12px] tabular-nums text-[var(--muted)]">
                {current ? `いま〜${range.endTime}` : `${range.startTime}〜${range.endTime}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- 鍵まわりの入口 ----------

function KeysEntry({ summary, href }: { summary: KeysSummary; href: string }) {
  return (
    <Link
      href={href}
      prefetch
      data-tour="room-board"
      className={`${groupClass} flex items-center gap-3 px-4 py-3`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="var(--tint)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="shrink-0"
      >
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="M10.7 12.3L20 3M16 7l3 3M14 9l2 2" />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px]">練習場所の鍵・部室の鍵・連絡</span>
        <span className="block truncate text-[13px] text-[var(--muted)]">
          開錠 {summary.unlocked}部屋 / 部室の鍵: {summary.holder ?? "未登録"}
        </span>
      </span>
      <span aria-hidden className="text-[var(--muted)]">
        ›
      </span>
    </Link>
  );
}

// ---------- カレンダーの見出し・週の帯 ----------

function CalendarHeader({
  selectedDate,
  today,
  monthOpen,
  onToday,
  onToggleMonth,
  viewSwitch,
  filterButton,
}: {
  selectedDate: DateString;
  today: DateString;
  monthOpen: boolean;
  onToday: () => void;
  onToggleMonth: () => void;
  viewSwitch: React.ReactNode;
  filterButton: React.ReactNode;
}) {
  /*
   * **1行にまとめる** (v1.31.7)。以前は「年月」の行と「選んだ日 + 一覧/時間/部屋」の
   * 行が分かれていて、週の帯と予定の間が空いていた。年月は月表示の中に出す。
   * どれも高さ 36px 以上 (押しやすさ)
   */
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleMonth}
        aria-expanded={monthOpen}
        aria-label={monthOpen ? "週の表示に戻す" : "月の表示に広げる"}
        className="flex h-9 shrink-0 items-center gap-1 text-[17px] font-bold tabular-nums"
      >
        {formatDateLabel(selectedDate)}
        <svg
          viewBox="0 0 14 8"
          width="11"
          height="7"
          aria-hidden
          className={`text-[var(--tint)] transition-transform duration-300 ${
            monthOpen ? "rotate-180" : ""
          }`}
        >
          <path
            d="M1 1l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {selectedDate !== today ? (
        <button
          type="button"
          onClick={onToday}
          className="h-9 shrink-0 rounded-full bg-[var(--fill)] px-2.5 text-[14px] font-semibold text-[var(--tint)]"
        >
          今日
        </button>
      ) : null}
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1">{viewSwitch}</div>
        {filterButton}
      </div>
    </div>
  );
}

/** 高さをなめらかに伸び縮みさせる箱 (grid-template-rows 0fr ↔ 1fr) */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 1週間の帯 (§6.7.13)。読み込んだ範囲の週を横に並べ、スナップで1週ずつ止める。
 *
 * 滑らせて週が変わったら、**同じ曜日の日**を選び直す (iPhone のカレンダーと同じ)。
 * 範囲の外の日を押したら、その日を中心にページごと読み直す。
 */
function WeekStrip({
  rangeStart,
  rangeEnd,
  selectedDate,
  today,
  eventsByDate,
  onSelect,
}: {
  rangeStart: DateString;
  rangeEnd: DateString;
  selectedDate: DateString;
  today: DateString;
  eventsByDate: Map<DateString, MyEvent[]>;
  onSelect: (date: DateString) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => {
    const first = addDays(rangeStart, -getWeekday(rangeStart));
    const list: DateString[][] = [];
    for (let start = first; start <= rangeEnd; start = addDays(start, 7)) {
      list.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    }
    return list;
  }, [rangeStart, rangeEnd]);

  const selectedWeek = Math.max(
    0,
    weeks.findIndex((week) => week.includes(selectedDate)),
  );
  /** 指で滑らせて週を変えた直後は、位置合わせのスクロールをしない (二重に動くため) */
  const fromSwipe = useRef(false);
  const firstScroll = useRef(true);

  // 選んだ日の週へ合わせる。最初は一瞬で、その後 (月表示から選んだときなど) はなめらかに
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (fromSwipe.current) {
      fromSwipe.current = false;
      return;
    }
    const left = selectedWeek * el.clientWidth;
    if (Math.abs(el.scrollLeft - left) < 2) return;
    el.scrollTo({ left, behavior: firstScroll.current ? "instant" : "smooth" });
    firstScroll.current = false;
  }, [selectedWeek]);

  /**
   * 指 (またはトラックパッド) で動かしたときだけ、週の変化を「日を選び直した」と読む。
   * ブラウザがスクロール位置を復元したときや、画面の幅が変わったときの位置のずれで
   * 選んだ日まで変わってしまわないようにするため
   */
  const touched = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer = 0;
    function settle() {
      if (!touched.current) return;
      touched.current = false;
      const index = Math.round(el!.scrollLeft / el!.clientWidth);
      if (index === selectedWeek || !weeks[index]) return;
      fromSwipe.current = true;
      onSelect(weeks[index][getWeekday(selectedDate)]);
    }
    function onScroll() {
      window.clearTimeout(timer);
      // scrollend が無いブラウザもあるので、止まってから少し待って判定する
      timer = window.setTimeout(settle, 90);
    }
    function onTouch() {
      touched.current = true;
    }
    // 幅が変わったら (画面の回転など)、選んでいる週に合わせ直す
    function onResize() {
      el!.scrollTo({ left: selectedWeek * el!.clientWidth, behavior: "instant" });
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", onTouch, { passive: true });
    el.addEventListener("touchstart", onTouch, { passive: true });
    el.addEventListener("wheel", onTouch, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", onTouch);
      el.removeEventListener("touchstart", onTouch);
      el.removeEventListener("wheel", onTouch);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, [weeks, selectedWeek, selectedDate, onSelect]);

  return (
    <div className="rounded-xl bg-[var(--cell)] py-2">
      <div className="grid grid-cols-7 px-1 pb-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <span
            key={label}
            className={`text-center text-[11px] ${
              i === 0
                ? "text-[var(--accent)]"
                : i === 6
                  ? "text-[var(--info)]"
                  : "text-[var(--muted)]"
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <div
        ref={scroller}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        // 帯の中の横の動きはタブの切り替え (SwipeTabs) に渡さない
        data-no-swipe
      >
        {weeks.map((week) => (
          <div
            key={week[0]}
            className="grid w-full shrink-0 snap-start snap-always grid-cols-7 px-1"
          >
            {week.map((date) => {
              const isSelected = date === selectedDate;
              const isToday = date === today;
              const dayEvents = eventsByDate.get(date) ?? [];
              const outOfRange = date < rangeStart || date > rangeEnd;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelect(date)}
                  aria-current={isSelected ? "date" : undefined}
                  aria-label={`${formatDateLabel(date)} 予定${dayEvents.length}件`}
                  className={`flex flex-col items-center gap-1 py-1 ${
                    outOfRange ? "opacity-40" : ""
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-full text-[17px] tabular-nums transition-colors duration-200 ${
                      isSelected
                        ? isToday
                          ? "bg-[var(--accent)] font-semibold text-white"
                          : "bg-[var(--primary)] font-semibold text-[var(--primary-fg)]"
                        : isToday
                          ? "font-semibold text-[var(--accent)]"
                          : ""
                    }`}
                  >
                    {parseDate(date).day}
                  </span>
                  <span className="flex h-1.5 gap-0.5">
                    {dayEvents.slice(0, 3).map((event, i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: eventColor(event).bg }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 絞り込み (§6.7.13) ----------

function FilterButton({
  filter,
  otherGenres,
  onChange,
}: {
  filter: Filter;
  otherGenres: string[];
  onChange: (filter: Filter) => void;
}) {
  const [open, setOpen] = useState(false);
  const added = filter.genres.length + (filter.free ? 1 : 0);

  function toggleGenre(code: string, on: boolean) {
    onChange({
      ...filter,
      genres: on ? [...filter.genres, code] : filter.genres.filter((g) => g !== code),
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={added > 0 ? `表示するもの (${added}つ追加中)` : "表示するもの (自分の予定だけ)"}
        className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] font-semibold ${
          added > 0 ? "bg-[var(--tint)] text-white" : "bg-[var(--fill)] text-[var(--tint)]"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        {/* 見出しの1行に収めるため短く (v1.31.7)。足しているときは色と数で分かる */}
        {added > 0 ? `表示 +${added}` : "表示"}
      </button>

      {open ? (
        <Sheet
          title="表示するもの"
          onClose={() => setOpen(false)}
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChange(DEFAULT_FILTER)}
                className={fillButtonClass}
              >
                自分の予定だけ
              </button>
              <button
                type="button"
                onClick={() => onChange({ genres: [...otherGenres], free: true })}
                className={primaryButtonClass}
              >
                全部表示
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <ul className={groupClass}>
              <li className="flex min-h-[48px] items-center justify-between gap-3 px-4">
                <span className="text-[17px]">自分の予定</span>
                <span className="text-[15px] text-[var(--muted)]">常に表示</span>
              </li>
              <li className="flex min-h-[48px] items-center justify-between gap-3 px-4">
                <span className="flex items-center gap-2 text-[17px]">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#34c759]" />
                  空き (自主練できる時間)
                </span>
                <Switch
                  label="空きを表示"
                  checked={filter.free}
                  onChange={(free) => onChange({ ...filter, free })}
                />
              </li>
            </ul>
            <div>
              <GroupHeader>ほかのジャンルの公式練</GroupHeader>
              <ul className={groupClass}>
                {otherGenres.map((code) => (
                  <li
                    key={code}
                    className="flex min-h-[48px] items-center justify-between gap-3 px-4"
                  >
                    <span className="flex items-center gap-2 text-[17px]">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: GENRE_COLORS[code as GenreCode]?.bg }}
                      />
                      {code}
                    </span>
                    <Switch
                      label={`${code}を表示`}
                      checked={filter.genres.includes(code)}
                      onChange={(on) => toggleGenre(code, on)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

// ---------- 選んだ日の予定 ----------

interface Row {
  key: string;
  startTime: string;
  endTime: string;
  wholeDay: boolean;
  title: string;
  subtitle: string;
  color: { bg: string; fg: string };
  pale: boolean;
  important?: boolean;
  /** 今日の終わった予定。薄く出す (v1.31.6) */
  ended?: boolean;
  /** 「空き」。時間表の折りたたみの判断に使わない (DayTimeline の filler) */
  filler?: boolean;
  onClick?: () => void;
}

/**
 * 選んだ日の予定。**一覧**と**時間表**で同じ行を使う。
 * 自分の予定は濃く、絞り込みで足した他ジャンルの練習と空きは薄く下に。
 */
function DayContent({
  date,
  today,
  view,
  mine,
  blocks,
  filter,
  mySlotIds,
  onSelect,
  onClaim,
}: {
  date: DateString;
  today: DateString;
  view: "list" | "time";
  mine: Entry[];
  blocks: DayBlock[];
  filter: Filter;
  mySlotIds: Set<string>;
  onSelect: (event: MyEvent) => void;
  onClaim: (slot: DayBlock, range: TimeRange) => void;
}) {
  const roomById = useRoomById();
  const [expanded, setExpanded] = useState(false);
  // 今日を選んでいるときは、終わった予定を後ろへ回して薄くする (v1.31.6。
  // 以前の「今日」の欄の動き)。サーバーとずれないよう描画後に読む
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    if (date !== today) return;
    setNow(nowTimeInTokyo());
    const timer = window.setInterval(() => setNow(nowTimeInTokyo()), 60_000);
    return () => window.clearInterval(timer);
  }, [date, today]);
  const ended = (entry: Entry) =>
    date === today && now !== null && !isWholeDayEntry(entry) && entry.endTime <= now;
  const ordered = [...mine.filter((e) => !ended(e)), ...mine.filter(ended)];

  const mineRows: Row[] = ordered.map((entry) => {
    const event = entry.event;
    const note = event.lastDate
      ? multiDayNote(event, date)
      : spanNote(entry.part, event.startTime, event.endTime);
    const dueNote =
      event.kind === "deadline" ? (event.dueTime ? `${event.dueTime}まで` : "この日中") : null;
    return {
      key: `${event.kind}-${event.sourceId}-${entry.date}`,
      startTime: entry.startTime,
      endTime: entry.endTime,
      wholeDay: isWholeDayEntry(entry),
      title: event.title,
      subtitle: [event.location, note, dueNote].filter(Boolean).join(" · "),
      color: eventColor(event),
      pale: false,
      ended: ended(entry),
      important: event.important,
      onClick: () => onSelect(event),
    };
  });

  // ---- 絞り込みで足した他ジャンルの公式練 (同じ時間・同じジャンルは部屋をまとめる) ----
  const groups = new Map<string, { block: DayBlock; rooms: string[] }>();
  for (const block of blocks) {
    if (block.status !== "genre" || mySlotIds.has(block.id)) continue;
    if (!block.genreCode || !filter.genres.includes(block.genreCode)) continue;
    const key = `${block.genreCode}|${block.startTime}|${block.endTime}`;
    const group = groups.get(key) ?? { block, rooms: [] };
    group.rooms.push(roomById.get(block.roomId)?.name ?? "");
    groups.set(key, group);
  }
  const otherRows: Row[] = [...groups.values()].map(({ block, rooms }) => ({
    key: `other-${block.id}`,
    startTime: block.startTime,
    endTime: block.endTime,
    wholeDay: false,
    title: `${block.genreCode} 公式練`,
    subtitle: rooms.filter(Boolean).join("・"),
    color: GENRE_COLORS[block.genreCode as GenreCode] ?? SLOT_OPEN_COLOR,
    pale: true,
  }));

  // ---- 空き (押すと申請) ----
  const freeRows: Row[] = filter.free
    ? blocks
        .filter((block) => block.status === "open")
        .flatMap((block) =>
          freeRanges(block, block.claims).map((range) => ({
            key: `free-${block.id}-${range.startTime}`,
            startTime: range.startTime,
            endTime: range.endTime,
            wholeDay: false,
            title: "空き",
            subtitle: roomById.get(block.roomId)?.name ?? "",
            color: { bg: "rgba(52, 199, 89, 0.35)", fg: "var(--foreground)" },
            pale: true,
            filler: true,
            onClick: () => onClaim(block, range),
          })),
        )
    : [];

  const others = [...otherRows, ...freeRows].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  if (view === "time") {
    const actions = new Map<string, () => void>();
    const toItem = (row: Row): TimelineEvent => {
      if (row.onClick) actions.set(row.key, row.onClick);
      return {
        key: row.key,
        startTime: row.startTime,
        endTime: row.endTime,
        title: `${row.important ? "【大事】" : ""}${row.title}`,
        subtitle: row.subtitle,
        color: row.color,
        pale: row.pale,
        filler: row.filler,
      };
    };
    return (
      <DayTimeline
        date={date}
        events={[...mineRows.filter((r) => !r.wholeDay), ...others].map(toItem)}
        allDay={mineRows.filter((r) => r.wholeDay).map(toItem)}
        onSelect={(item) => actions.get(item.key)?.()}
      />
    );
  }

  if (mineRows.length === 0 && others.length === 0) {
    return (
      <p className={`${groupClass} px-4 py-4 text-center text-[15px] text-[var(--muted)]`}>
        予定はありません
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mineRows.length > 0 ? (
        <ul className={groupClass}>
          {(expanded || mineRows.length <= DAY_VISIBLE + 1
            ? mineRows
            : mineRows.slice(0, DAY_VISIBLE)
          ).map((row) => (
            <ListRow key={row.key} row={row} />
          ))}
          {/* 3件を超えたら折りたたむ (1件だけ隠すのは手間が増えるだけなので、4件までは全部出す) */}
          {mineRows.length > DAY_VISIBLE + 1 ? (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-[15px] text-[var(--tint)]"
              >
                {expanded ? "閉じる" : `ほか ${mineRows.length - DAY_VISIBLE}件`}
                <svg
                  viewBox="0 0 14 8"
                  width="11"
                  height="7"
                  aria-hidden
                  className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
                >
                  <path
                    d="M1 1l6 6 6-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className={`${groupClass} px-4 py-3 text-[15px] text-[var(--muted)]`}>
          自分の予定はありません
        </p>
      )}
      {others.length > 0 ? (
        <div>
          <GroupHeader>ほかの練習・空き</GroupHeader>
          <ul className={groupClass}>
            {others.map((row) => (
              <ListRow key={row.key} row={row} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function multiDayNote(event: MyEvent, date: DateString): string {
  const days = `${formatDateLabel(event.date)}〜${formatDateLabel(event.lastDate!)}`;
  return date === event.date ? days : `${days}の続き`;
}

function ListRow({ row }: { row: Row }) {
  const content = (
    <>
      <span
        aria-hidden
        className="w-1 shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: row.color.bg }}
      />
      <span className="w-[52px] shrink-0 pt-px text-[13px] leading-tight tabular-nums text-[var(--muted)]">
        {row.wholeDay ? (
          "終日"
        ) : (
          <>
            {row.startTime}
            <br />
            {row.endTime}
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[16px] leading-snug">
          {row.important ? <ImportantBadge /> : null}
          <span className="truncate">{row.title}</span>
        </span>
        {row.subtitle ? (
          <span className="block truncate text-[13px] text-[var(--muted)]">{row.subtitle}</span>
        ) : null}
      </span>
    </>
  );
  const className = `flex w-full gap-3 px-4 py-2.5 text-left ${
    row.pale ? "opacity-55" : row.ended ? "opacity-50" : ""
  }`;
  return (
    <li>
      {row.onClick ? (
        <button type="button" onClick={row.onClick} className={className}>
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

// ---------- イベント・締切の詳細 ----------

function EventDetailSheet({ event, onClose }: { event: MyEvent; onClose: () => void }) {
  const days = event.lastDate
    ? `${formatDateLabel(event.date)}〜${formatDateLabel(event.lastDate)}`
    : formatDateLabel(event.date);
  const time =
    event.kind === "deadline"
      ? event.dueTime
        ? `${event.dueTime}まで`
        : "この日中"
      : event.allDay
        ? "終日"
        : `${event.startTime}〜${event.endTime}`;

  return (
    <Sheet
      title={event.kind === "deadline" ? "締切" : "イベント"}
      onClose={onClose}
      footer={
        event.url ? (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className={primaryButtonClass}
          >
            リンクを開く
          </a>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-[20px] font-semibold">
          {event.important ? <ImportantBadge /> : null}
          {event.title.replace(/^締切: /, "")}
        </p>
        <dl className={`${groupClass} text-[16px]`}>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <dt className="text-[var(--muted)]">
              {event.kind === "deadline" ? "期限" : "日にち"}
            </dt>
            <dd className="text-right">
              {days} {time}
            </dd>
          </div>
          {event.location ? (
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-[var(--muted)]">場所</dt>
              <dd className="text-right">{event.location}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </Sheet>
  );
}
