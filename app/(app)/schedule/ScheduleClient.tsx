"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorMessage, GroupHeader, Segmented, groupClass, primaryButtonClass } from "@/components/ui";
import { GENRE_COLORS, ROOM_BY_ID, type GenreCode } from "@/lib/constants";
import learned from "@/lib/scheduling/learned.json";
import { measure, type PlanMetrics } from "@/lib/scheduling/metrics";
import { DEFAULT_SETTINGS, answerKey, defaultPerGenre, isBigRoom } from "@/lib/scheduling/plan";
import { sizeWeight } from "@/lib/scheduling/rooms";
import type {
  Answer,
  AnswerKey,
  Candidate,
  PlanInput,
  PlanResult,
  PlanSettings,
} from "@/lib/scheduling/types";
import { roundTitle, type ScheduleRound } from "@/lib/scheduling/round";
import { formatDateLabel, getWeekday, parseDate, todayInTokyo } from "@/lib/time";

/**
 * 日程調整 (SPEC.md §6.8.4 / v1.33.1)。
 *
 * **回答と割り振りは別の画面にする。** 回答 (`/schedule`) は全員、集計と割り振り
 * (`/schedule/plan`) は折衝・3役だけ。いまは見本のデータ (150人・来月の予約枠) で
 * 動き、保存はされない。
 */

// ---------- 回答 (§6.8.2) ----------

export function ScheduleAnswerClient({
  initialInput,
  me,
  round,
}: {
  initialInput: PlanInput;
  me: string;
  round: ScheduleRound;
}) {
  const [input, setInput] = useState(initialInput);
  const mine = input.answers[me] ?? {};
  const slots = useMemo(() => answerSlots(input.candidates), [input.candidates]);
  const allKeys = useMemo(() => keysOf(slots), [slots]);
  const answeredCount = allKeys.filter((key) => mine[key]).length;
  /** 今選んでいるペン (v1.33.1)。コマを押すとこの印が付く */
  const [pen, setPen] = useState<Answer>("ok");

  function setMany(keys: AnswerKey[], value: Answer | undefined) {
    const next = { ...mine };
    for (const key of keys) {
      if (value) next[key] = value;
      else delete next[key];
    }
    setInput((prev) => ({ ...prev, answers: { ...prev.answers, [me]: next } }));
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">{roundTitle(round)}</h1>
      <DeadlineCard round={round} answered={answeredCount} total={allKeys.length} />

      {/*
        ペン (v1.33.1)。選んでからコマを押す。印の意味はペンの文字が示すので、
        説明文や凡例は置かない。スクロールしても手元に残るよう上に貼り付ける
      */}
      <div className="sticky top-0 z-20 -mx-4 bg-[var(--background)] px-4 pb-2 pt-1">
        <div role="radiogroup" aria-label="付ける印" className="grid grid-cols-3 gap-2">
          {(["ok", "maybe", "no"] as Answer[]).map((value) => {
            const on = pen === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPen(value)}
                className={`flex h-14 flex-col items-center justify-center rounded-2xl leading-tight transition-colors active:scale-[0.97] ${
                  on ? PEN_STYLE[value].on : "bg-[var(--cell)]"
                }`}
              >
                <span className={`text-[20px] font-bold ${on ? "" : PEN_STYLE[value].mark}`}>
                  {ANSWER_STYLE[value].label}
                </span>
                <span className="text-[12px]">{PEN_STYLE[value].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <BulkCard
        pen={pen}
        onApply={(weekdays) =>
          setMany(
            keysOf(weekdays.length ? slots.filter((s) => weekdays.includes(getWeekday(s.date))) : slots),
            pen,
          )
        }
      />

      <ul className="space-y-2">
        {slots.map(({ date, ranges }) => {
          const wd = getWeekday(date);
          return (
            <li key={date} className="rounded-2xl bg-[var(--cell)] px-3 py-2.5">
              <p
                className={`mb-2 text-[15px] font-semibold tabular-nums ${
                  wd === 0 ? "text-[var(--accent)]" : wd === 6 ? "text-[var(--info)]" : ""
                }`}
              >
                {formatDateLabel(date)}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ranges.map(({ start, end }) => {
                  const key = answerKey(date, start, end);
                  const value = mine[key] ?? "none";
                  const style = ANSWER_STYLE[value];
                  return (
                    <button
                      key={key}
                      type="button"
                      // 今のペンを付ける。同じ印が付いていたら未回答に戻す
                      onClick={() => setMany([key], value === pen ? undefined : pen)}
                      aria-label={`${formatDateLabel(date)} ${start}〜${end} ${ANSWER_WORD[value]}`}
                      className="flex h-12 items-center justify-between gap-2 rounded-xl bg-[var(--fill)] pl-3 pr-1.5 transition-transform active:scale-[0.97]"
                    >
                      <span className="text-[14px] tabular-nums">
                        {start}〜{end}
                      </span>
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[18px] font-bold transition-colors ${style.className}`}
                      >
                        {style.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

/**
 * 締切と回答の進み具合 (v1.33.1)。状態のチップを並べる代わりに、
 * 一番気にすること (あと何日・どこまで答えたか) を大きく1枚で見せる
 */
function DeadlineCard({
  round,
  answered,
  total,
}: {
  round: ScheduleRound;
  answered: number;
  total: number;
}) {
  const days = daysBetween(todayInTokyo(), round.deadline);
  const done = total > 0 && answered === total;
  return (
    <section className="rounded-2xl bg-[var(--cell)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[34px] font-bold leading-none tabular-nums">
            {days <= 0 ? "今日まで" : `あと${days}日`}
          </p>
          <p className="mt-1.5 text-[15px] text-[var(--muted)] tabular-nums">
            {formatDateLabel(round.deadline)} 23:59 締切
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[13px] font-semibold ${
            done ? "bg-[#34c759] text-white" : "bg-[var(--fill)]"
          }`}
        >
          {done ? "回答済み" : "受付中"}
        </span>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--fill)]"
        role="progressbar"
        aria-label="回答したコマ"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
      >
        <div
          className="h-full rounded-full bg-[#34c759] transition-[width] duration-300"
          style={{ width: `${total ? (answered / total) * 100 : 0}%` }}
        />
      </div>
      <p className="mt-1.5 text-[13px] text-[var(--muted)] tabular-nums">
        {answered}/{total}コマ
      </p>
    </section>
  );
}

const ANSWER_STYLE: Record<Answer | "none", { label: string; className: string }> = {
  ok: { label: "○", className: "bg-[#34c759] text-white" },
  maybe: { label: "△", className: "bg-[#ff9f0a] text-white" },
  no: { label: "×", className: "bg-[var(--muted)] text-white opacity-70" },
  none: { label: "−", className: "bg-[var(--fill)] text-[var(--muted)]" },
};
/** ペンの見た目。選んでいるペンは印の色で塗る */
const PEN_STYLE: Record<Answer, { label: string; on: string; mark: string }> = {
  ok: { label: "出られる", on: "bg-[#34c759] text-white", mark: "text-[#34c759]" },
  maybe: { label: "できれば避けたい", on: "bg-[#ff9f0a] text-white", mark: "text-[#ff9f0a]" },
  no: { label: "出られない", on: "bg-[var(--muted)] text-white", mark: "text-[var(--muted)]" },
};
/** 読み上げ用 */
const ANSWER_WORD: Record<Answer | "none", string> = {
  ok: "出られる",
  maybe: "できれば避けたい",
  no: "出られない",
  none: "未回答",
};
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

/** 回答する日とコマの時間 (その日に予約枠のあるコマの時間だけ。§6.8.2 / v1.32.1) */
function answerSlots(candidates: Candidate[]): { date: string; ranges: { start: string; end: string }[] }[] {
  const map = new Map<string, Map<string, { start: string; end: string }>>();
  for (const c of candidates) {
    const ranges = map.get(c.date) ?? new Map();
    ranges.set(`${c.startTime}-${c.endTime}`, { start: c.startTime, end: c.endTime });
    map.set(c.date, ranges);
  }
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ranges]) => ({
      date,
      ranges: [...ranges.values()].sort((x, y) => x.start.localeCompare(y.start)),
    }));
}

function keysOf(list: ReturnType<typeof answerSlots>): AnswerKey[] {
  return list.flatMap((s) => s.ranges.map((r) => answerKey(s.date, r.start, r.end)));
}

/**
 * まとめて付ける (§6.8.2 / v1.33.1)。曜日を選び (選ばなければ全部の日)、
 * 今のペンで塗る
 */
function BulkCard({ pen, onApply }: { pen: Answer; onApply: (weekdays: number[]) => void }) {
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const target = weekdays.length
    ? `${[1, 2, 3, 4, 5, 6, 0].filter((d) => weekdays.includes(d)).map((d) => WEEKDAY[d]).join("・")}曜日`
    : "全部の日";

  function apply() {
    onApply(weekdays);
    setDone(`${target}を${ANSWER_STYLE[pen].label}にしました`);
    window.setTimeout(() => setDone(null), 1800);
  }

  return (
    <section className="space-y-3 rounded-2xl bg-[var(--cell)] p-4">
      <h2 className="text-[17px] font-bold">まとめて付ける</h2>
      <div className="flex justify-between gap-1" role="group" aria-label="曜日">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const on = weekdays.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setWeekdays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
              className={`grid h-11 w-11 place-items-center rounded-full text-[15px] font-semibold transition-colors active:scale-95 ${
                on
                  ? "bg-[var(--tint)] text-white"
                  : `bg-[var(--fill)] ${d === 0 ? "text-[var(--accent)]" : d === 6 ? "text-[var(--info)]" : ""}`
              }`}
            >
              {WEEKDAY[d]}
            </button>
          );
        })}
      </div>
      {/* 押すと何が起きるかをボタンの文字で示す (説明文は置かない) */}
      <button
        type="button"
        onClick={apply}
        className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-bold active:opacity-80 ${PEN_STYLE[pen].on}`}
      >
        {target}を<span className="text-[20px]">{ANSWER_STYLE[pen].label}</span>にする
      </button>
      <p className="h-5 text-center text-[14px] text-[var(--tint)]" aria-live="polite">
        {done}
      </p>
    </section>
  );
}

// ---------- 集計と割り振り (§6.8.3。折衝・3役だけ) ----------

export function SchedulePlanClient({
  initialInput,
  round,
  canPlan,
}: {
  initialInput: PlanInput;
  round: ScheduleRound;
  /** 折衝・3役か。違えば中身を出さない (計算の API 側でも同じ権限を確かめる) */
  canPlan: boolean;
}) {
  if (!canPlan) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-center text-[15px] text-[var(--muted)]">
        折衝と3役だけが使える画面です
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">
        {parseDate(round.month).month}月の割り振り
      </h1>
      <PlanPanel input={initialInput} round={round} />
    </main>
  );
}

function PlanPanel({ input, round }: { input: PlanInput; round: ScheduleRound }) {
  const [settings, setSettings] = useState<PlanSettings>(() => ({
    ...DEFAULT_SETTINGS,
    perGenre: defaultPerGenre(input),
  }));
  const [result, setResult] = useState<PlanResult | null>(null);
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const answered = input.members.filter((m) => Object.keys(input.answers[m.id] ?? {}).length > 0).length;
  const total = input.candidates.length;
  const genres = input.genres.length;
  const maxPerGenre = Math.floor(total / genres);
  const used = Math.min(total, settings.perGenre * genres);

  async function run() {
    setPending(true);
    setError(null);
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    try {
      const res = await fetch("/api/schedule/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, settings }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "計算できませんでした。");
        return;
      }
      setResult(body as PlanResult);
    } catch {
      setError("通信できませんでした。電波の良いところでもう一度押してください。");
    } finally {
      window.clearInterval(timer);
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="回答した人" value={`${answered}/${input.members.length}`} />
        <Stat
          label="締切"
          sub={formatDateLabel(round.deadline)}
          value={(() => {
            const days = daysBetween(todayInTokyo(), round.deadline);
            return days < 0 ? "締切済み" : days === 0 ? "今日" : `あと${days}日`;
          })()}
        />
        <Stat label="予約したコマ" value={`${total}`} />
      </div>

      <section className={`${groupClass} space-y-4 p-4`}>
        <h2 className="text-[17px] font-bold">各ジャンルのコマ数</h2>
        <div className="flex items-center justify-center gap-4">
          <StepButton label="減らす" onClick={() => setSettings({ ...settings, perGenre: Math.max(0, settings.perGenre - 1) })}>−</StepButton>
          <p className="min-w-[96px] text-center">
            <span className="text-[34px] font-bold tabular-nums">{settings.perGenre}</span>
            <span className="text-[16px]"> コマ</span>
          </p>
          <StepButton label="増やす" onClick={() => setSettings({ ...settings, perGenre: Math.min(maxPerGenre, settings.perGenre + 1) })}>＋</StepButton>
        </div>
        {/* 使うコマ / 予約したコマ を棒で見せる */}
        <div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--fill)]">
            <div
              className="h-full rounded-full bg-[var(--tint)] transition-[width] duration-300"
              style={{ width: `${(used / total) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-[13px] text-[var(--muted)] tabular-nums">
            {genres}ジャンル × {settings.perGenre} = {used}コマを使う・空き {total - used}コマ
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="flex h-11 w-full items-center justify-between gap-3 rounded-xl bg-[var(--fill)] px-3 text-[15px]"
        >
          <span className="shrink-0">詳細設定</span>
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--muted)]">
            <span className="truncate">{advanced ? null : summaryOf(settings)}</span>
            <svg viewBox="0 0 14 8" width="12" height="8" aria-hidden className={`shrink-0 transition-transform ${advanced ? "rotate-180" : ""}`}>
              <path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
        </button>
        {advanced ? (
          <div className="space-y-4">
            <Choice
              label="同じジャンルの1日の上限"
              hint="2コマ以上入れる日は、必ず時間を続けます。"
              value={settings.maxPerDay}
              options={[
                { value: 1, label: "1コマ" },
                { value: 2, label: "2コマ" },
                { value: 3, label: "3コマ" },
              ]}
              onChange={(maxPerDay) => setSettings({ ...settings, maxPerDay })}
            />
            <Choice
              label="続けて入れるときの部屋"
              hint="続けて入れるコマを、同じ部屋にそろえるかどうか。"
              value={settings.sameRoomBonus}
              options={[
                { value: 0, label: "気にしない" },
                { value: 2, label: "できれば同じ" },
                { value: 5, label: "なるべく同じ" },
              ]}
              onChange={(sameRoomBonus) => setSettings({ ...settings, sameRoomBonus })}
            />
            <Choice
              label="欠席の偏り"
              hint="特定の曜日しか空いていない人が、毎回欠席になる案を避けます。"
              value={settings.fairnessWeight}
              options={[
                { value: 0, label: "気にしない" },
                { value: learned.fairnessWeight || 1, label: "ふつう" },
                { value: Math.max(4, (learned.fairnessWeight || 1) * 3), label: "強く" },
              ]}
              onChange={(fairnessWeight) => setSettings({ ...settings, fairnessWeight })}
            />
            <Choice
              label="広い部屋での通し練習"
              hint="どのジャンルも、月にこの回数は広い部屋で練習できるようにします。"
              value={settings.minBigPerGenre}
              options={[
                { value: 0, label: "決めない" },
                { value: 1, label: "月1回" },
                { value: 2, label: "月2回" },
              ]}
              onChange={(minBigPerGenre) => setSettings({ ...settings, minBigPerGenre })}
            />
            <RoomSizes
              roomIds={[...new Set(input.candidates.map((c) => c.roomId))].sort((a, b) => a - b)}
              value={settings.roomWeights}
              onChange={(roomWeights) => setSettings({ ...settings, roomWeights })}
            />
            <Choice
              label="△ (できれば避けたい) の数え方"
              hint="△ の人を何人ぶんと数えるか。"
              value={settings.maybeWeight}
              options={[
                { value: 0, label: "数えない" },
                { value: 0.5, label: "半分" },
                { value: 1, label: "○と同じ" },
              ]}
              onChange={(maybeWeight) => setSettings({ ...settings, maybeWeight })}
            />
            <Choice
              label="2・3ジャンの人の数え方"
              hint="1ジャンの人を1人としたときの重さ。"
              value={settings.genreWeights[1]}
              options={[
                { value: 1, label: "同じ" },
                { value: 0.7, label: "少し軽く" },
                { value: 0.5, label: "かなり軽く" },
              ]}
              onChange={(w) =>
                setSettings({ ...settings, genreWeights: [1, w, w === 1 ? 1 : w === 0.7 ? 0.5 : 0.3] })
              }
            />
            <Choice
              label="人が少ないコマに印を付ける"
              hint="見込みがこの人数に届かないコマを、赤い枠で示します。"
              value={settings.minPeople}
              options={[
                { value: 0, label: "付けない" },
                { value: 5, label: "5人未満" },
                { value: 8, label: "8人未満" },
                { value: 10, label: "10人未満" },
              ]}
              onChange={(minPeople) => setSettings({ ...settings, minPeople })}
            />
          </div>
        ) : null}

        <button type="button" onClick={run} disabled={pending} className={primaryButtonClass}>
          {pending ? "計算しています…" : result ? "条件を変えて作り直す" : "案を作る"}
        </button>
        {pending ? <Progress elapsed={elapsed} limit={settings.timeLimitSeconds} /> : null}
        <ErrorMessage>{error}</ErrorMessage>
      </section>

      {result && !pending ? <ResultView input={input} result={result} settings={settings} /> : null}
    </div>
  );
}

function summaryOf(settings: PlanSettings): string {
  const maybe = settings.maybeWeight === 0 ? "△数えない" : settings.maybeWeight === 1 ? "△=○" : "△半分";
  const sub = settings.genreWeights[1] === 1 ? "2ジャン同じ" : settings.genreWeights[1] === 0.7 ? "2ジャン少し軽く" : "2ジャンかなり軽く";
  const room = settings.sameRoomBonus === 0 ? "部屋気にしない" : "部屋そろえる";
  const fair = settings.fairnessWeight === 0 ? "" : "・偏りを抑える";
  const big = settings.minBigPerGenre ? `・広い部屋 月${settings.minBigPerGenre}回` : "";
  return `1日${settings.maxPerDay}コマまで・${room}${fair}${big}・${maybe}・${sub}`;
}

/**
 * 練習場所の広さ (v1.32.3)。広い部屋ほど、人が多く集まるジャンルに回りやすくなる。
 * 部屋ごとに 狭い / 普通 / 広い を選ぶ
 */
function RoomSizes({
  roomIds,
  value,
  onChange,
}: {
  roomIds: number[];
  value: Record<number, number>;
  onChange: (value: Record<number, number>) => void;
}) {
  const options = (["small", "normal", "large"] as const).map((size) => ({
    value: sizeWeight(size, learned.roomStrength),
    label: size === "small" ? "狭い" : size === "large" ? "広い" : "普通",
  }));
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-semibold">練習場所の広さ</p>
      <ul className="divide-y divide-[var(--separator)] rounded-xl bg-[var(--fill)]">
        {roomIds.map((roomId) => {
          const current = value[roomId] ?? 1;
          return (
            <li key={roomId} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              <span className="min-w-0 flex-1 truncate text-[15px]">
                {(ROOM_BY_ID.get(roomId)?.name ?? "?").replace(/[(（][^)）]*[)）]$/, "")}
              </span>
              <span className="flex shrink-0 gap-1">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={current === o.value}
                    onClick={() => onChange({ ...value, [roomId]: o.value })}
                    className={`h-9 rounded-full px-3 text-[14px] transition-colors ${
                      current === o.value
                        ? "bg-[var(--tint)] font-semibold text-white"
                        : "text-[var(--foreground)]"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-[var(--muted)]">広い部屋ほど、人の多いジャンルに回りやすくなります。</p>
    </div>
  );
}

/** 選択肢のボタン (Segmented) に見出しと説明を付けたもの */
function Choice<T extends number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-semibold">{label}</p>
      <Segmented
        label={label}
        value={String(value)}
        size="large"
        options={options.map((o) => ({ value: String(o.value), label: o.label }))}
        onChange={(v) => onChange(Number(v) as T)}
      />
      <p className="text-[13px] text-[var(--muted)]">{hint}</p>
    </div>
  );
}

/**
 * 計算中の表示 (v1.32.2)。1回の問い合わせなので本当の進み具合は分からないが、
 * 経過秒数と、時間に応じた段階を出して「動いている」ことを見せる
 */
function Progress({ elapsed, limit }: { elapsed: number; limit: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // 下のタブバーに隠れないよう、出たときに画面の中ほどへ送る
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  const steps = ["回答を集計しています", "割り振りを計算しています", "結果をまとめています"];
  const step = elapsed < 0.8 ? 0 : elapsed < limit * 0.8 ? 1 : 2;
  return (
    <div ref={ref} className="space-y-2 rounded-xl bg-[var(--fill)] p-3" role="status" aria-live="polite">
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--cell)]">
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-[var(--tint)]" />
      </div>
      <ol className="space-y-1 text-[14px]">
        {steps.map((text, i) => (
          <li key={text} className={`flex items-center gap-2 ${i > step ? "text-[var(--muted)]" : ""}`}>
            <span aria-hidden className="w-4 text-center">
              {i < step ? "✓" : i === step ? "●" : "○"}
            </span>
            {text}
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-[var(--muted)] tabular-nums">
        {elapsed.toFixed(0)}秒経過・ふつう5〜20秒(最大{limit}秒)
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[var(--cell)] px-3 py-2.5">
      <p className="text-[13px] text-[var(--muted)]">{label}</p>
      <p className="text-[17px] font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-[12px] text-[var(--muted)] tabular-nums">{sub}</p> : null}
    </div>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-12 w-12 place-items-center rounded-full bg-[var(--fill)] text-[22px] text-[var(--tint)] active:opacity-60"
    >
      {children}
    </button>
  );
}

function ResultView({
  input,
  result,
  settings,
}: {
  input: PlanInput;
  result: PlanResult;
  settings: PlanSettings;
}) {
  const genreCode = new Map(input.genres.map((g) => [g.id, g.code]));
  const byCandidate = new Map(result.assignments.map((a) => [a.candidateId, a]));
  const dates = [...new Set(input.candidates.map((c) => c.date))].sort();
  const below = result.assignments.filter((a) => a.belowMin).length;
  const overlaps = result.assignments.filter((a) => a.lostToOverlap > 0).length;

  const byIdAll = new Map(input.candidates.map((c) => [c.id, c]));
  const bigCount = (genreId: number) =>
    result.assignments.filter(
      (a) => a.genreId === genreId && isBigRoom(settings, byIdAll.get(a.candidateId)!.roomId),
    ).length;

  if (result.status === "infeasible" || result.status === "error") {
    return <ErrorMessage>{result.message ?? "計算できませんでした"}</ErrorMessage>;
  }

  return (
    <div className="space-y-4">
      <section className={`${groupClass} space-y-3 p-4`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-bold">案</h2>
          <span className="text-[13px] text-[var(--muted)] tabular-nums">
            {result.status === "optimal" ? "最適(差 0.5% 以内)" : "制限時間内で一番良い案"} ・ {(result.elapsedMs / 1000).toFixed(1)}秒
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {result.perGenre.map((g) => {
            const code = genreCode.get(g.genreId) ?? "?";
            const color = GENRE_COLORS[code as GenreCode];
            return (
              <li key={g.genreId} className="rounded-lg px-2 py-1.5" style={{ backgroundColor: color?.bg, color: color?.fg }}>
                <span className="block text-[13px] font-bold">{code}</span>
                <span className="block text-[12px] opacity-90 tabular-nums">
                  {g.slots}コマ・平均{g.slots ? (g.expected / g.slots).toFixed(1) : "0"}人
                </span>
                <span className="block text-[11px] opacity-90 tabular-nums">
                  広い部屋 {bigCount(g.genreId)}回
                </span>
              </li>
            );
          })}
        </ul>
        {result.message ? (
          <p className="rounded-lg bg-[var(--fill)] px-3 py-2 text-[14px]">{result.message}</p>
        ) : null}
        <Scorecard metrics={measure(input, settings, result)} />
        <p className="text-[14px] text-[var(--muted)]">
          {below > 0 ? `人数の基準に届かないコマ ${below}件(赤い枠)。` : ""}
          {overlaps > 0 ? `1ジャンと2・3ジャンが重なったコマ ${overlaps}件(「重なり」)。` : "1ジャンと2・3ジャンの重なりはありません。"}
        </p>
        <button type="button" disabled className={`${primaryButtonClass} opacity-50`}>
          この案で下書きに入れる(DB を作る段階で使えます)
        </button>
      </section>

      {dates.map((date) => (
        <DateGrid
          key={date}
          date={date}
          candidates={input.candidates.filter((c) => c.date === date)}
          byCandidate={byCandidate}
          genreCode={genreCode}
          maybeWeight={settings.maybeWeight}
        />
      ))}
    </div>
  );
}

/** 案の採点 (§6.8.6)。条件の学習と同じ物差しで、この案がどうだったかを出す */
function Scorecard({ metrics }: { metrics: PlanMetrics }) {
  const items = [
    { label: "参加率", value: `${(metrics.participation * 100).toFixed(0)}%`, hint: "1ジャンの練習に出られる割合の平均" },
    { label: "出にくい人", value: `${(metrics.bottom10 * 100).toFixed(0)}%`, hint: "下位1割の人の参加率" },
    { label: "広い部屋", value: `最少${metrics.minBigRooms}回`, hint: "一番少ないジャンルの回数" },
  ];
  return (
    <ul className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <li key={item.label} className="rounded-lg bg-[var(--fill)] px-2.5 py-2">
          <span className="block text-[12px] text-[var(--muted)]">{item.label}</span>
          <span className="block text-[18px] font-bold tabular-nums">{item.value}</span>
          <span className="block text-[11px] leading-tight text-[var(--muted)]">{item.hint}</span>
        </li>
      ))}
    </ul>
  );
}

/** 1日ぶんのコマ割り表。建物ごとに、行 = コマの時間、列 = 部屋 (画像のコマ割り表と同じ形) */
function DateGrid({
  date,
  candidates,
  byCandidate,
  genreCode,
  maybeWeight,
}: {
  date: string;
  candidates: Candidate[];
  byCandidate: Map<string, PlanResult["assignments"][number]>;
  genreCode: Map<number, string>;
  maybeWeight: number;
}) {
  const sections = [...new Set(candidates.map((c) => c.section))];
  return (
    <section>
      <GroupHeader>{formatDateLabel(date)}</GroupHeader>
      <div className="space-y-2">
        {sections.map((section) => {
          const list = candidates.filter((c) => c.section === section);
          const rooms = [...new Set(list.map((c) => c.roomId))].sort((a, b) => a - b);
          const times = [...new Set(list.map((c) => `${c.startTime}〜${c.endTime}`))].sort();
          return (
            <div key={section} className="overflow-hidden rounded-xl bg-[var(--cell)]">
              <table className="w-full table-fixed text-[13px]">
                <thead>
                  <tr className="text-[var(--muted)]">
                    <th className="w-[92px] px-2 py-1.5 text-left font-semibold">{section}</th>
                    {rooms.map((roomId) => (
                      <th key={roomId} className="px-1 py-1.5 font-normal">
                        {(ROOM_BY_ID.get(roomId)?.name ?? "?").replace(/[(（][^)）]*[)）]$/, "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {times.map((range) => (
                    <tr key={range} className="border-t border-[var(--separator)]">
                      <td className="px-2 py-1 tabular-nums text-[var(--muted)]">{range}</td>
                      {rooms.map((roomId) => {
                        const c = list.find((x) => x.roomId === roomId && `${x.startTime}〜${x.endTime}` === range);
                        if (!c) return <td key={roomId} />;
                        const a = byCandidate.get(c.id);
                        if (!a) {
                          return (
                            <td key={roomId} className="px-1 py-1 text-center text-[var(--muted)]">
                              ○
                            </td>
                          );
                        }
                        const code = genreCode.get(a.genreId) ?? "?";
                        const color = GENRE_COLORS[code as GenreCode];
                        return (
                          <td key={roomId} className="p-0.5">
                            <div
                              className={`rounded-md px-1 py-0.5 text-center leading-tight ${a.belowMin ? "ring-2 ring-[var(--danger-solid)]" : ""}`}
                              style={{ backgroundColor: color?.bg, color: color?.fg }}
                            >
                              <span className="block font-bold">{code}</span>
                              <span className="block text-[11px] tabular-nums opacity-90">
                                ○{a.ok} △{a.maybe} ≒{(a.ok + a.maybe * maybeWeight).toFixed(0)}人
                              </span>
                              {a.lostToOverlap > 0 ? (
                                <span className="block text-[10px]">重なり −{a.lostToOverlap}</span>
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}
