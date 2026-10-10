"use client";

import { useEffect, useMemo, useState } from "react";

import {
  AttendanceSheet,
  type AttendanceTarget,
} from "@/components/AttendanceSheet";
import { ClaimSheet } from "@/components/ClaimSheet";
import { ClubKeyBoard } from "@/components/ClubKeyBoard";
import { DayGrid, type DayBlock } from "@/components/DayGrid";
import { DayTimeline, type TimelineEvent } from "@/components/DayTimeline";
import { LabelCalendar } from "@/components/LabelCalendar";
import {
  NotificationList,
  type NotificationRow,
} from "@/components/NotificationList";
import { RoomStatusBoard, type RoomStatusRow } from "@/components/RoomStatusBoard";
import { Sheet } from "@/components/Sheet";
import {
  GroupHeader,
  ImportantBadge,
  Segmented,
  groupClass,
  primaryButtonClass,
} from "@/components/ui";
import type { BoardMessage } from "@/lib/board-messages";
import { freeRanges, type TimeRange } from "@/lib/claims";
import type { KeyHolderRow } from "@/lib/club-key";
import {
  GENRES,
  GENRE_COLORS,
  SLOT_CLAIMED_COLOR,
  SLOT_OPEN_COLOR,
  type GenreCode,
} from "@/lib/constants";
import { spanNote } from "@/lib/day-span";
import {
  eventColor,
  eventFilterKey,
  expandMyEvents,
  isAlwaysShown,
} from "@/lib/event-display";
import { numberColor } from "@/lib/numbers";
import { useRoomById } from "@/lib/rooms";
import {
  CLAIM_STEP_MINUTES,
  formatDateLabel,
  fromMinutes,
  nowTimeInTokyo,
  toMinutes,
} from "@/lib/time";
import type { DateString, MyEvent } from "@/lib/types";

/**
 * カレンダーの操作部 (SPEC.md §6.7.7 / v1.30)
 *
 * 上から: 鍵のボード (現役) → 近い締切 → いま空いている部屋 → お知らせ →
 *         絞り込みチップ → 予定ラベル付きの月カレンダー → 選んだ日の予定
 *
 * 選んだ日は縦タイムラインで出す。自分に関係するものを濃く、他ジャンルの練習と
 * 空きコマは右の列に薄く。「部屋ごと」に切り替えると、従来の部屋×時間の表 (§6.1)。
 * (一覧で出す案は docs/major-update.md の「提案中」。決まるまで入れない)
 */

/** チップの選択を覚えておくキー (§6.4-3「選択状態はローカル保存」) */
const FILTER_STORAGE_KEY = "me-calendar-filter";
/** 「部屋ごと」の選択を覚えておくキー */
const VIEW_STORAGE_KEY = "calendar-day-view";

export interface UpcomingDeadline {
  id: string;
  title: string;
  dueDate: DateString;
  dueTime: string | null;
  url: string | null;
  important: boolean;
}

type DayView = "agenda" | "rooms";

export function CalendarHome({
  monthAnchor,
  initialDate,
  today,
  events,
  blocksByDate,
  notifications,
  numbers,
  genreCodes,
  isOb,
  currentUserId,
  upcomingDeadlines,
  boards,
}: {
  monthAnchor: DateString;
  initialDate: DateString;
  today: DateString;
  events: MyEvent[];
  /** その月 (と今日) の公開済みコマ。OB は空 */
  blocksByDate: Record<DateString, DayBlock[]>;
  notifications: NotificationRow[];
  numbers: { id: string; name: string }[];
  /** 自分の1〜3ジャン。その月に予定が無くてもチップは出す */
  genreCodes: string[];
  isOb: boolean;
  currentUserId: string;
  upcomingDeadlines: UpcomingDeadline[];
  /** 鍵のボード (現役のみ。OB は null) */
  boards: {
    roomStatusRows: RoomStatusRow[];
    roomMessages: BoardMessage[];
    keyHolderRows: KeyHolderRow[];
    keyMessages: BoardMessage[];
  } | null;
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [filter, setFilter] = useState("all");
  const [dayView, setDayView] = useState<DayView>("agenda");
  /** 出欠管理窓・詳細を開いている予定 */
  const [selected, setSelected] = useState<MyEvent | null>(null);
  /** 申請シートを開いている空き */
  const [claiming, setClaiming] = useState<{
    date: DateString;
    slot: DayBlock;
    range: TimeRange;
  } | null>(null);

  // localStorage はサーバーで読めないので、描画後に反映する
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (saved) setFilter(saved);
      const view = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (view === "rooms" && !isOb) setDayView("rooms");
    } catch {
      // 保存が使えない環境でも表示はできる
    }
  }, [isOb]);

  function selectFilter(key: string) {
    setFilter(key);
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, key);
    } catch {}
  }

  function selectDayView(view: DayView) {
    setDayView(view);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {}
  }

  function selectDate(date: DateString) {
    setSelectedDate(date);
    // 今日を選んだときは ?date= を消す。残すと次に開いたとき当時の日付が出る
    window.history.replaceState(
      null,
      "",
      date === today
        ? window.location.pathname
        : `?date=${encodeURIComponent(date)}`,
    );
  }

  const visible = events.filter(
    (event) =>
      filter === "all" || isAlwaysShown(event) || eventFilterKey(event) === filter,
  );
  // **日をまたぐ深夜練・複数日のイベントは日ごとに割る** (v1.21 / v1.30)。
  // 同じ日の中は**終日 (イベント・締切) を先頭**に、あとは開始時刻順。
  // 合宿の2日目は前日から続く予定なので、並べ直さないと後ろへ回ってしまう
  const entries = expandMyEvents(visible).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const wholeA = isWholeDayEntry(a);
    const wholeB = isWholeDayEntry(b);
    if (wholeA !== wholeB) return wholeA ? -1 : 1;
    return a.startTime.localeCompare(b.startTime);
  });

  const eventsByDate = new Map<DateString, MyEvent[]>();
  for (const entry of entries) {
    const list = eventsByDate.get(entry.date) ?? [];
    list.push(entry.event);
    eventsByDate.set(entry.date, list);
  }

  // 自分の公式練として既に出ているコマ。「ほかの練習」から外す
  const mySlotIds = useMemo(
    () =>
      new Set(
        events.filter((event) => event.kind === "genre").flatMap((e) => e.sourceIds),
      ),
    [events],
  );

  const chips: { key: string; label: string; color?: string }[] = [
    { key: "all", label: "すべて" },
    ...(isOb
      ? []
      : genreCodes.map((code) => ({
          key: `genre:${code}`,
          label: code,
          color: GENRE_COLORS[code as GenreCode]?.bg,
        }))),
    ...(isOb ? [] : [{ key: "claim", label: "空き申請", color: SLOT_CLAIMED_COLOR.bg }]),
    ...numbers.map((number) => ({
      key: `number:${number.id}`,
      label: number.name,
      color: numberColor(number.id).bg,
    })),
  ];

  const todayBlocks = blocksByDate[today] ?? [];
  const dayBlocks = blocksByDate[selectedDate] ?? [];

  return (
    <>
      {boards ? (
        <div className="space-y-2">
          <RoomStatusBoard
            today={today}
            roomIds={[...new Set(todayBlocks.map((block) => block.roomId))]}
            initialRows={boards.roomStatusRows}
            initialMessages={boards.roomMessages}
            currentUserId={currentUserId}
          />
          <ClubKeyBoard
            initialRows={boards.keyHolderRows}
            currentUserId={currentUserId}
            initialMessages={boards.keyMessages}
          />
        </div>
      ) : null}

      <UpcomingDeadlines deadlines={upcomingDeadlines} today={today} />

      {isOb ? null : (
        <FreeRoomsNow
          blocks={todayBlocks}
          onClaim={(slot, range) => setClaiming({ date: today, slot, range })}
        />
      )}

      <NotificationList initial={notifications} />

      <div data-tour="calendar" className="space-y-1.5">
        {/*
          **絞り込みはチップの列をやめ、ここに格納する** (§6.7.7 / v1.30.1)。
          使う人は多くないのに、横に流れる列が毎回カレンダーの上を1段占めていた。
          絞り込み中は名前を出し、× で解除できる (予定が消えたように見えないように)
        */}
        {chips.length > 1 ? (
          <FilterButton
            chips={chips}
            value={filter}
            onChange={selectFilter}
          />
        ) : null}
        <LabelCalendar
          basePath="/"
          monthAnchor={monthAnchor}
          selectedDate={selectedDate}
          today={today}
          eventsByDate={eventsByDate}
          onSelectDate={selectDate}
        />
      </div>

      <section className="space-y-2" data-tour="day">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[20px] font-bold">
            {formatDateLabel(selectedDate)}
            {selectedDate === today ? (
              <span className="ml-1.5 text-[15px] font-normal text-[var(--muted)]">
                今日
              </span>
            ) : null}
          </h2>
          {isOb ? null : (
            <div className="w-40">
              <Segmented
                label="表示のしかた"
                value={dayView}
                onChange={selectDayView}
                options={[
                  { value: "agenda", label: "時間" },
                  { value: "rooms", label: "部屋ごと" },
                ]}
              />
            </div>
          )}
        </div>

        {dayView === "rooms" && !isOb ? (
          <DayGrid
            date={selectedDate}
            blocks={dayBlocks}
            currentUserId={currentUserId}
          />
        ) : (
          <DayView
            date={selectedDate}
            mine={entries.filter((entry) => entry.date === selectedDate)}
            blocks={filter === "all" ? dayBlocks : []}
            mySlotIds={mySlotIds}
            onSelect={setSelected}
            onClaim={(slot, range) =>
              setClaiming({ date: selectedDate, slot, range })
            }
          />
        )}
      </section>

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

/** 終日の予定か、複数日イベントの中日 (その日は丸1日) */
function isWholeDayEntry(entry: {
  event: MyEvent;
  startTime: string;
  endTime: string;
}): boolean {
  return (
    Boolean(entry.event.allDay) ||
    (entry.startTime === "00:00" && entry.endTime === "24:00")
  );
}

/** 空き申請は出欠の対象外なので情報表示だけにする (§6.4.2) */
function attendanceTarget(event: MyEvent): AttendanceTarget {
  // 同じ時間帯に部屋を2つ押さえた公式練は1件にまとめてあるので、
  // 出欠を読むときは元のコマ全部を渡す (§6.4-1 / v1.12)
  if (event.kind === "genre") {
    return { kind: "slot", id: event.sourceId, ids: event.sourceIds };
  }
  if (event.kind === "number") {
    return { kind: "numberEvent", id: event.sourceId };
  }
  // スタ練も公式練と同じように出欠を答えられる (§6.3.1 / v1.24)
  if (event.kind === "studio") {
    const genreId = GENRES.find((g) => g.code === event.genreCode)?.id;
    if (genreId !== undefined) {
      return { kind: "studioPractice", id: event.sourceId, genreId };
    }
  }
  return { kind: "info" };
}

// ---------- 絞り込み (§6.7.7 / v1.30.1) ----------

function FilterButton({
  chips,
  value,
  onChange,
}: {
  chips: { key: string; label: string; color?: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = chips.find((chip) => chip.key === value && chip.key !== "all");

  return (
    <div className="flex justify-end">
      {active ? (
        <span className="flex items-center gap-1 rounded-full bg-[var(--fill)] py-1 pl-3 pr-1 text-[13px] font-medium">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5"
          >
            {active.color ? (
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: active.color }}
              />
            ) : null}
            {active.label}だけ表示中
          </button>
          <button
            type="button"
            aria-label="絞り込みを解除"
            onClick={() => onChange("all")}
            className="grid h-6 w-6 place-items-center rounded-full text-[var(--muted)]"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 px-1 text-[13px] text-[var(--tint)]"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          絞り込み
        </button>
      )}

      {open ? (
        <Sheet title="絞り込み" onClose={() => setOpen(false)}>
          <ul className={groupClass}>
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(chip.key);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-[17px]"
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: chip.color ?? "transparent" }}
                  />
                  <span className="flex-1">{chip.label}</span>
                  {chip.key === value ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--tint)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label="選択中">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </div>
  );
}

// ---------- 選んだ日の予定 ----------

/**
 * 選んだ日の縦タイムライン (§6.4 / §6.7.7)。
 *
 * 自分の予定を濃く、**他ジャンルの練習と空きコマは右の列に薄く**出す。
 * 終日の予定 (イベント・締切) は時間軸の上に並べる。
 * 押したときの動き: 自分の予定 → 出欠 (イベント・締切は詳細) / 空き → 申請。
 */
function DayView({
  date,
  mine,
  blocks,
  mySlotIds,
  onSelect,
  onClaim,
}: {
  date: DateString;
  mine: ReturnType<typeof expandMyEvents>;
  /** その日の公開済みコマ。絞り込み中は空 (自分の予定だけを見たいとき) */
  blocks: DayBlock[];
  mySlotIds: Set<string>;
  onSelect: (event: MyEvent) => void;
  onClaim: (slot: DayBlock, range: TimeRange) => void;
}) {
  const roomById = useRoomById();
  const actions = new Map<string, () => void>();
  const allDay: TimelineEvent[] = [];
  const timed: TimelineEvent[] = [];

  for (const entry of mine) {
    const event = entry.event;
    const key = `${event.kind}-${event.sourceId}-${entry.date}`;
    actions.set(key, () => onSelect(event));
    const note = event.lastDate
      ? multiDayNote(event, date)
      : spanNote(entry.part, event.startTime, event.endTime);
    const dueNote =
      event.kind === "deadline" ? (event.dueTime ? `${event.dueTime}まで` : null) : null;
    const item: TimelineEvent = {
      key,
      startTime: entry.startTime,
      endTime: entry.endTime,
      title: `${event.important ? "【大事】" : ""}${event.title}`,
      subtitle: [event.location, note, dueNote].filter(Boolean).join(" · "),
      color: eventColor(event),
    };
    if (isWholeDayEntry(entry)) allDay.push(item);
    else timed.push(item);
  }

  // ---- ほかのジャンルの練習 (同じ時間・同じジャンルは部屋をまとめて1つ) ----
  const otherGroups = new Map<string, { block: DayBlock; rooms: string[] }>();
  for (const block of blocks) {
    if (block.status !== "genre" || mySlotIds.has(block.id)) continue;
    const key = `${block.genreCode}|${block.startTime}|${block.endTime}`;
    const group = otherGroups.get(key) ?? { block, rooms: [] };
    group.rooms.push(roomById.get(block.roomId)?.name ?? "");
    otherGroups.set(key, group);
  }
  for (const { block, rooms } of otherGroups.values()) {
    timed.push({
      key: `other-${block.id}`,
      startTime: block.startTime,
      endTime: block.endTime,
      title: `${block.genreCode ?? "?"} 公式練`,
      subtitle: rooms.filter(Boolean).join("・"),
      color: GENRE_COLORS[block.genreCode as GenreCode] ?? SLOT_OPEN_COLOR,
      pale: true,
    });
  }

  // ---- 空き (申請が入っていない時間帯。押すと申請シート) ----
  for (const block of blocks) {
    if (block.status !== "open") continue;
    for (const range of freeRanges(block, block.claims)) {
      const key = `free-${block.id}-${range.startTime}`;
      actions.set(key, () => onClaim(block, range));
      timed.push({
        key,
        startTime: range.startTime,
        endTime: range.endTime,
        title: "空き",
        subtitle: roomById.get(block.roomId)?.name ?? "",
        // 空きの地の色は背景に近すぎて見えないので、「使える」の緑を薄く敷く
        color: { bg: "rgba(52, 199, 89, 0.35)", fg: "var(--foreground)" },
        pale: true,
      });
    }
  }

  return (
    <DayTimeline
      date={date}
      events={timed}
      allDay={allDay}
      onSelect={(item) => actions.get(item.key)?.()}
    />
  );
}

function multiDayNote(event: MyEvent, date: DateString): string {
  const days = `${formatDateLabel(event.date)}〜${formatDateLabel(event.lastDate!)}`;
  return date === event.date ? days : `${days}の続き`;
}

// ---------- 近い締切 (§6.7.2) ----------

function UpcomingDeadlines({
  deadlines,
  today,
}: {
  deadlines: UpcomingDeadline[];
  today: DateString;
}) {
  if (deadlines.length === 0) return null;
  return (
    <section data-tour="deadlines">
      <GroupHeader>近い締切</GroupHeader>
      <ul className={groupClass}>
        {deadlines.map((deadline) => {
          const days = daysBetween(today, deadline.dueDate);
          const inner = (
            <>
              <span
                className={`w-14 shrink-0 text-[13px] font-semibold tabular-nums ${
                  days <= 1 ? "text-[var(--danger-solid)]" : "text-[var(--muted)]"
                }`}
              >
                {days === 0 ? "今日" : days === 1 ? "明日" : `あと${days}日`}
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
              {deadline.url ? (
                <span className="shrink-0 text-[15px] text-[var(--tint)]">開く</span>
              ) : null}
            </>
          );
          return (
            <li key={deadline.id}>
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
        })}
      </ul>
    </section>
  );
}

function daysBetween(from: DateString, to: DateString): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

// ---------- いま空いている部屋 (§6.7.5) ----------

function FreeRoomsNow({
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
    // 1分ごとに数え直す。画面を開いたままでも「〜まで」が古くならない
    const timer = window.setInterval(() => setNow(nowTimeInTokyo()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (now === null) return null;
  const nowMinutes = toMinutes(now);
  // 申請は10分単位なので、開始は今を10分単位に切り上げた時刻
  const start = fromMinutes(
    Math.ceil(nowMinutes / CLAIM_STEP_MINUTES) * CLAIM_STEP_MINUTES,
  );

  const rows = blocks
    .filter((block) => block.status === "open")
    .flatMap((block) =>
      freeRanges(block, block.claims)
        .filter(
          (range) =>
            toMinutes(range.startTime) <= nowMinutes &&
            toMinutes(range.endTime) - toMinutes(start) >= CLAIM_STEP_MINUTES,
        )
        .map((range) => ({ block, range })),
    )
    .sort((a, b) => b.range.endTime.localeCompare(a.range.endTime));

  if (rows.length === 0) return null;

  return (
    <section data-tour="free-rooms">
      <GroupHeader>いま空いている部屋</GroupHeader>
      <ul className={groupClass}>
        {rows.map(({ block, range }) => (
          <li key={`${block.id}-${range.startTime}`}>
            <button
              type="button"
              onClick={() =>
                onClaim(block, { startTime: start, endTime: range.endTime })
              }
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#34c759]"
              />
              <span className="min-w-0 flex-1 truncate text-[16px]">
                {roomById.get(block.roomId)?.name ?? "?"}
              </span>
              <span className="shrink-0 text-[13px] text-[var(--muted)]">
                {range.endTime}まで
              </span>
              <span className="shrink-0 text-[15px] text-[var(--tint)]">申請</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- イベント・締切の詳細 ----------

function EventDetailSheet({
  event,
  onClose,
}: {
  event: MyEvent;
  onClose: () => void;
}) {
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
            <dt className="text-[var(--muted)]">{event.kind === "deadline" ? "期限" : "日にち"}</dt>
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
